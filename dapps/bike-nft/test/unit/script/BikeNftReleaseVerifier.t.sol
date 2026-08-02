pragma solidity 0.8.35;

import {Test} from "forge-std-1.12.0/src/Test.sol";

import {CamRoot} from "cam/src/CamRoot.sol";
import {BikeNftReleaseVerifier} from "../../../script/BikeNftReleaseVerifier.sol";
import {BicycleComponentManager} from "../../../src/BicycleComponentManager.sol";
import {BicycleComponentManagerUI} from "../../../src/BicycleComponentManagerUI.sol";
import {BicycleComponents} from "../../../src/BicycleComponents.sol";

contract BikeNftReleaseVerifierHarness is BikeNftReleaseVerifier {
    function verify(Artifact memory artifact, string memory sourceCommit) external {
        verifyArtifact(artifact, sourceCommit);
    }
}

contract BikeNftReleaseVerifierTest is Test {
    string private constant SOURCE_COMMIT = "0123456789abcdef0123456789abcdef01234567";
    string private constant CAM_URI = "https://example.test/bike-nft/v1/main.json";
    bytes32 private constant CAM_HASH = keccak256("bike CAM");
    uint48 private constant ADMIN_DELAY = 1 days;

    address private constant DEPLOYER = address(0xD001);
    address private constant ROOT_OWNER = address(0xA001);
    address private constant COMPONENTS_ADMIN = address(0xA002);
    address private constant COMPONENTS_PAUSER = address(0xA003);
    address private constant COMPONENTS_CONFIGURER = address(0xA004);
    address private constant MANAGER_ADMIN = address(0xA005);
    address private constant MANAGER_PAUSER = address(0xA006);
    address private constant MANAGER_CONFIGURER = address(0xA007);
    address private constant REGISTRAR = address(0xA008);

    BikeNftReleaseVerifierHarness private verifier;
    CamRoot private root;
    BicycleComponents private components;
    BicycleComponentManager private manager;
    BicycleComponentManagerUI private ui;

    function setUp() public {
        vm.chainId(11155111);
        verifier = new BikeNftReleaseVerifierHarness();
        vm.startPrank(DEPLOYER);
        root = new CamRoot(DEPLOYER, CAM_URI, CAM_HASH);
        components = new BicycleComponents(
            "Bicycle Components",
            "BIKE",
            DEPLOYER,
            ADMIN_DELAY,
            "https://example.test/tokens/",
            "https://example.test/collection.json"
        );
        manager = new BicycleComponentManager(DEPLOYER, ADMIN_DELAY, address(components));
        ui = new BicycleComponentManagerUI(address(manager));
        components.grantRole(components.MINTER_ROLE(), address(manager));
        components.grantRole(components.TOKEN_URI_SETTER_ROLE(), address(manager));
        components.grantRole(components.PAUSER_ROLE(), COMPONENTS_PAUSER);
        components.grantRole(components.CONFIGURER_ROLE(), COMPONENTS_CONFIGURER);
        manager.grantRole(manager.PAUSER_ROLE(), MANAGER_PAUSER);
        manager.grantRole(manager.CONFIGURER_ROLE(), MANAGER_CONFIGURER);
        manager.grantRole(manager.REGISTRAR_ROLE(), REGISTRAR);
        components.revokeRole(components.PAUSER_ROLE(), DEPLOYER);
        components.revokeRole(components.CONFIGURER_ROLE(), DEPLOYER);
        manager.revokeRole(manager.PAUSER_ROLE(), DEPLOYER);
        manager.revokeRole(manager.CONFIGURER_ROLE(), DEPLOYER);
        root.setContractAddress("BicycleComponentManager", address(manager));
        root.setContractAddress("BicycleComponentManagerUI", address(ui));
        root.transferOwnership(ROOT_OWNER);
        components.beginDefaultAdminTransfer(COMPONENTS_ADMIN);
        manager.beginDefaultAdminTransfer(MANAGER_ADMIN);
        vm.stopPrank();
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
                DEPLOYER
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
        components.grantRole(minterRole, DEPLOYER);
        vm.expectRevert(
            abi.encodeWithSelector(
                bytes4(keccak256("RoleMismatch(string,bytes32,address,bool)")),
                "deployer components minter",
                minterRole,
                DEPLOYER,
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
        address[] memory registrars = new address[](1);
        registrars[0] = REGISTRAR;
        artifact = BikeNftReleaseVerifier.Artifact({
            sourceCommit: SOURCE_COMMIT,
            chainId: block.chainid,
            deployer: DEPLOYER,
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
            registrars: registrars,
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
}
