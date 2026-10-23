pragma solidity 0.8.35;

import {Test} from "forge-std-1.12.0/src/Test.sol";

import {CamRoot} from "cam/src/CamRoot.sol";
import {BikeNftReleaseVerifier} from "../../../script/BikeNftReleaseVerifier.sol";
import {DeployBikeNftRelease} from "../../../script/DeployBikeNftRelease.s.sol";
import {BicycleComponentManager} from "../../../src/BicycleComponentManager.sol";
import {BicycleComponentManagerUI} from "../../../src/BicycleComponentManagerUI.sol";
import {BicycleComponents} from "../../../src/BicycleComponents.sol";

contract BikeNftReleaseVerifierHarness is BikeNftReleaseVerifier {
    function verify(Artifact memory artifact, string memory sourceCommit) external {
        verifyArtifact(artifact, sourceCommit);
    }
}

contract BikeNftReleaseDeploymentHarness is DeployBikeNftRelease {
    function deployRelease(ReleasePlan memory plan) external returns (Deployment memory) {
        return _deployRelease(plan, address(this));
    }

    function validatePlan(ReleasePlan memory plan) external view {
        _validatePlan(plan);
    }
}

contract BikeNftReleaseVerifierTest is Test {
    string private constant SOURCE_COMMIT = "0123456789abcdef0123456789abcdef01234567";
    string private constant CAM_URI = "https://example.test/bike-nft/v1/main.json";
    bytes32 private constant CAM_HASH = sha256("bike CAM");
    uint48 private constant ADMIN_DELAY = 1 days;

    address private constant ROOT_OWNER = address(0xA001);
    address private constant COMPONENTS_ADMIN = address(0xA002);
    address private constant COMPONENTS_PAUSER = address(0xA003);
    address private constant COMPONENTS_CONFIGURER = address(0xA004);
    address private constant MANAGER_ADMIN = address(0xA005);
    address private constant MANAGER_PAUSER = address(0xA006);
    address private constant MANAGER_CONFIGURER = address(0xA007);
    address private constant REGISTRAR = address(0xA008);

    BikeNftReleaseVerifierHarness private verifier;
    address private deployer;
    CamRoot private root;
    BicycleComponents private components;
    BicycleComponentManager private manager;
    BicycleComponentManagerUI private ui;

    function setUp() public {
        vm.chainId(11155111);
        verifier = new BikeNftReleaseVerifierHarness();
        BikeNftReleaseDeploymentHarness deploymentHarness = new BikeNftReleaseDeploymentHarness();
        DeployBikeNftRelease.Deployment memory deployment = deploymentHarness.deployRelease(_releasePlan());
        deployer = address(deploymentHarness);
        root = deployment.camRoot;
        components = deployment.components;
        manager = deployment.manager;
        ui = deployment.ui;
    }

    function testVerifierAcceptsEmptyBaseAfterAuthorityHandoffs() public {
        vm.prank(COMPONENTS_CONFIGURER);
        components.setBaseURI("");
        BikeNftReleaseVerifier.Artifact memory artifact = _artifact();
        artifact.baseTokenURI = "";
        vm.expectRevert(
            abi.encodeWithSelector(
                BikeNftReleaseVerifier.AddressMismatch.selector, "intendedCamRootOwner", ROOT_OWNER, deployer
            )
        );
        verifier.verify(artifact, SOURCE_COMMIT);
        _acceptHandoffs();
        verifier.verify(artifact, SOURCE_COMMIT);
    }

    function testVerifierAcceptsCompletedRelease() public {
        _acceptHandoffs();
        verifier.verify(_artifact(), SOURCE_COMMIT);
    }

    function testExplicitDeployerAuthoritiesNeedNoSelfHandoffs() public {
        BikeNftReleaseVerifier.Artifact memory artifact = _deploySelectedDeployerAuthorities(false);
        verifier.verify(artifact, SOURCE_COMMIT);
        assertEq(root.owner(), deployer);
        assertEq(root.pendingOwner(), address(0));
        assertEq(components.defaultAdmin(), deployer);
        assertEq(manager.defaultAdmin(), deployer);
        assertTrue(components.hasRole(components.PAUSER_ROLE(), deployer));
        assertTrue(components.hasRole(components.CONFIGURER_ROLE(), deployer));
        assertTrue(manager.hasRole(manager.PAUSER_ROLE(), deployer));
        assertTrue(manager.hasRole(manager.CONFIGURER_ROLE(), deployer));
        assertTrue(manager.hasRole(manager.REGISTRAR_ROLE(), deployer));
    }

    function testMixedAuthoritiesKeepOnlySelectedDeployerRolesAndRequireTheOtherHandoff() public {
        BikeNftReleaseVerifier.Artifact memory artifact = _deploySelectedDeployerAuthorities(true);
        vm.expectRevert(
            abi.encodeWithSelector(
                BikeNftReleaseVerifier.AddressMismatch.selector, "intendedManagerAdmin", MANAGER_ADMIN, deployer
            )
        );
        verifier.verify(artifact, SOURCE_COMMIT);
        vm.warp(block.timestamp + ADMIN_DELAY + 1);
        vm.prank(MANAGER_ADMIN);
        manager.acceptDefaultAdminTransfer();
        verifier.verify(artifact, SOURCE_COMMIT);
        assertTrue(components.hasRole(components.PAUSER_ROLE(), deployer));
        assertFalse(components.hasRole(components.CONFIGURER_ROLE(), deployer));
        assertFalse(manager.hasRole(manager.PAUSER_ROLE(), deployer));
        assertTrue(manager.hasRole(manager.CONFIGURER_ROLE(), deployer));
        bytes32 pauserRole = manager.PAUSER_ROLE();
        vm.prank(MANAGER_ADMIN);
        manager.grantRole(pauserRole, deployer);
        vm.expectRevert(
            abi.encodeWithSelector(
                BikeNftReleaseVerifier.RoleMismatch.selector,
                "deployer manager pauser",
                manager.PAUSER_ROLE(),
                deployer,
                false
            )
        );
        verifier.verify(artifact, SOURCE_COMMIT);
    }

    function testVerifierRejectsPendingRootOwnership() public {
        BikeNftReleaseVerifier.Artifact memory artifact = _artifact();
        vm.expectRevert(
            abi.encodeWithSelector(
                bytes4(keccak256("AddressMismatch(string,address,address)")),
                "intendedCamRootOwner",
                ROOT_OWNER,
                deployer
            )
        );
        verifier.verify(artifact, SOURCE_COMMIT);
    }

    function testVerifierRejectsQueuedAdminDelayChange() public {
        _acceptHandoffs();
        vm.prank(COMPONENTS_ADMIN);
        components.changeDefaultAdminDelay(2 days);
        (uint48 pendingDelay, uint48 schedule) = components.pendingDefaultAdminDelay();
        BikeNftReleaseVerifier.Artifact memory artifact = _artifact();
        vm.expectRevert(
            abi.encodeWithSelector(
                bytes4(keccak256("PendingAdminDelay(string,uint48,uint48)")),
                "componentsAdminDelay",
                pendingDelay,
                schedule
            )
        );
        verifier.verify(artifact, SOURCE_COMMIT);
    }

    function testVerifierRejectsDeployerTokenRole() public {
        _acceptHandoffs();
        bytes32 minterRole = components.MINTER_ROLE();
        vm.prank(COMPONENTS_ADMIN);
        components.grantRole(minterRole, deployer);
        BikeNftReleaseVerifier.Artifact memory artifact = _artifact();
        vm.expectRevert(
            abi.encodeWithSelector(
                bytes4(keccak256("RoleMismatch(string,bytes32,address,bool)")),
                "deployer components minter",
                minterRole,
                deployer,
                false
            )
        );
        verifier.verify(artifact, SOURCE_COMMIT);
    }

    function testVerifierRejectsProjectionImmutableMismatch() public {
        _acceptHandoffs();
        BicycleComponentManager wrongManager =
            new BicycleComponentManager(address(this), ADMIN_DELAY, address(components));
        BicycleComponentManagerUI wrongUI = new BicycleComponentManagerUI(address(wrongManager));
        vm.prank(ROOT_OWNER);
        root.setContractAddress("BicycleComponentManagerUI", address(wrongUI));
        BikeNftReleaseVerifier.Artifact memory artifact = _artifact();
        artifact.ui = address(wrongUI);
        artifact.uiCodeHash = address(wrongUI).codehash;
        vm.expectRevert(
            abi.encodeWithSelector(
                bytes4(keccak256("AddressMismatch(string,address,address)")),
                "UI manager",
                address(manager),
                address(wrongManager)
            )
        );
        verifier.verify(artifact, SOURCE_COMMIT);
    }

    function testVerifierRejectsWrongComponentsBinding() public {
        _acceptHandoffs();
        vm.prank(ROOT_OWNER);
        root.setContractAddress("BicycleComponents", address(manager));
        BikeNftReleaseVerifier.Artifact memory artifact = _artifact();
        vm.expectRevert(
            abi.encodeWithSelector(
                bytes4(keccak256("AddressMismatch(string,address,address)")),
                "BicycleComponents binding",
                address(components),
                address(manager)
            )
        );
        verifier.verify(artifact, SOURCE_COMMIT);
    }

    function _deploySelectedDeployerAuthorities(bool mixed)
        private
        returns (BikeNftReleaseVerifier.Artifact memory artifact)
    {
        BikeNftReleaseDeploymentHarness deploymentHarness = new BikeNftReleaseDeploymentHarness();
        deployer = address(deploymentHarness);
        DeployBikeNftRelease.ReleasePlan memory plan = _releasePlan();
        plan.camHash = sha256(vm.readFileBinary("bike-nft/cam/main.json"));
        plan.intendedCamRootOwner = deployer;
        plan.intendedComponentsAdmin = deployer;
        plan.componentsPauser = deployer;
        plan.managerConfigurer = deployer;
        if (!mixed) {
            plan.componentsConfigurer = deployer;
            plan.intendedManagerAdmin = deployer;
            plan.managerPauser = deployer;
        }
        plan.registrars = new address[](2);
        plan.registrars[0] = deployer;
        plan.registrars[1] = REGISTRAR;
        deploymentHarness.validatePlan(plan);
        DeployBikeNftRelease.Deployment memory deployment = deploymentHarness.deployRelease(plan);
        root = deployment.camRoot;
        components = deployment.components;
        manager = deployment.manager;
        ui = deployment.ui;
        artifact = _artifact();
        artifact.camHash = plan.camHash;
        artifact.intendedCamRootOwner = plan.intendedCamRootOwner;
        artifact.intendedComponentsAdmin = plan.intendedComponentsAdmin;
        artifact.componentsPauser = plan.componentsPauser;
        artifact.componentsConfigurer = plan.componentsConfigurer;
        artifact.intendedManagerAdmin = plan.intendedManagerAdmin;
        artifact.managerPauser = plan.managerPauser;
        artifact.managerConfigurer = plan.managerConfigurer;
        artifact.registrars = plan.registrars;
    }

    function _acceptHandoffs() private {
        vm.prank(ROOT_OWNER);
        root.acceptOwnership();
        vm.warp(block.timestamp + ADMIN_DELAY + 1);
        vm.prank(COMPONENTS_ADMIN);
        components.acceptDefaultAdminTransfer();
        vm.prank(MANAGER_ADMIN);
        manager.acceptDefaultAdminTransfer();
    }

    function _artifact() private view returns (BikeNftReleaseVerifier.Artifact memory artifact) {
        DeployBikeNftRelease.ReleasePlan memory plan = _releasePlan();
        artifact = BikeNftReleaseVerifier.Artifact({
            sourceCommit: plan.sourceCommit,
            chainId: plan.expectedChainId,
            deployer: deployer,
            camURI: plan.camURI,
            camHash: plan.camHash,
            intendedCamRootOwner: plan.intendedCamRootOwner,
            tokenName: plan.tokenName,
            tokenSymbol: plan.tokenSymbol,
            baseTokenURI: plan.baseTokenURI,
            collectionURI: plan.collectionURI,
            intendedComponentsAdmin: plan.intendedComponentsAdmin,
            componentsAdminDelay: plan.componentsAdminDelay,
            componentsPauser: plan.componentsPauser,
            componentsConfigurer: plan.componentsConfigurer,
            intendedManagerAdmin: plan.intendedManagerAdmin,
            managerAdminDelay: plan.managerAdminDelay,
            managerPauser: plan.managerPauser,
            managerConfigurer: plan.managerConfigurer,
            registrars: plan.registrars,
            camRoot: address(root),
            components: address(components),
            manager: address(manager),
            ui: address(ui),
            camRootCodeHash: address(root).codehash,
            componentsCodeHash: address(components).codehash,
            managerCodeHash: address(manager).codehash,
            uiCodeHash: address(ui).codehash
        });
    }

    function _releasePlan() private pure returns (DeployBikeNftRelease.ReleasePlan memory plan) {
        address[] memory registrars = new address[](1);
        registrars[0] = REGISTRAR;
        plan = DeployBikeNftRelease.ReleasePlan({
            sourceCommit: SOURCE_COMMIT,
            expectedChainId: 11_155_111,
            camURI: CAM_URI,
            camHash: CAM_HASH,
            intendedCamRootOwner: ROOT_OWNER,
            tokenName: "Bicycle Components",
            tokenSymbol: "BIKE",
            baseTokenURI: "https://example.test/tokens/",
            collectionURI: "https://example.test/collection.json",
            intendedComponentsAdmin: COMPONENTS_ADMIN,
            componentsAdminDelay: ADMIN_DELAY,
            componentsPauser: COMPONENTS_PAUSER,
            componentsConfigurer: COMPONENTS_CONFIGURER,
            intendedManagerAdmin: MANAGER_ADMIN,
            managerAdminDelay: ADMIN_DELAY,
            managerPauser: MANAGER_PAUSER,
            managerConfigurer: MANAGER_CONFIGURER,
            registrars: registrars
        });
    }
}
