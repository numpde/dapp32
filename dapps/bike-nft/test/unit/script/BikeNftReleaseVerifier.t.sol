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
}

contract BikeNftReleaseVerifierTest is Test {
    string private constant SOURCE_COMMIT = "0123456789abcdef0123456789abcdef01234567";
    string private constant CAM_URI = "https://example.test/bike-nft/v1/main.json";
    bytes32 private constant CAM_HASH = keccak256("bike CAM");
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

    function testVerifierAcceptsCompletedRelease() public {
        _acceptHandoffs();
        verifier.verify(_artifact(), SOURCE_COMMIT);
    }

    function testVerifierRejectsPendingRootOwnership() public {
        vm.expectRevert(
            abi.encodeWithSelector(
                bytes4(keccak256("AddressMismatch(string,address,address)")),
                "intendedCamRootOwner",
                ROOT_OWNER,
                deployer
            )
        );
        verifier.verify(_artifact(), SOURCE_COMMIT);
    }

    function testVerifierRejectsQueuedAdminDelayChange() public {
        _acceptHandoffs();
        vm.prank(COMPONENTS_ADMIN);
        components.changeDefaultAdminDelay(2 days);
        (uint48 pendingDelay, uint48 schedule) = components.pendingDefaultAdminDelay();
        vm.expectRevert(
            abi.encodeWithSelector(
                bytes4(keccak256("PendingAdminDelay(string,uint48,uint48)")),
                "componentsAdminDelay",
                pendingDelay,
                schedule
            )
        );
        verifier.verify(_artifact(), SOURCE_COMMIT);
    }

    function testVerifierRejectsDeployerTokenRole() public {
        _acceptHandoffs();
        bytes32 minterRole = components.MINTER_ROLE();
        vm.prank(COMPONENTS_ADMIN);
        components.grantRole(minterRole, deployer);
        vm.expectRevert(
            abi.encodeWithSelector(
                bytes4(keccak256("RoleMismatch(string,bytes32,address,bool)")),
                "deployer components minter",
                minterRole,
                deployer,
                false
            )
        );
        verifier.verify(_artifact(), SOURCE_COMMIT);
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
