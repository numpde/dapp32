pragma solidity 0.8.35;

import {Test, Vm} from "forge-std-1.12.0/src/Test.sol";
import {BikeNftContractDeployment} from "../../../script/BikeNftContractDeployment.sol";
import {BikeNftUIDeployment} from "../../../script/BikeNftUIDeployment.sol";
import {BicycleComponentManager} from "../../../src/BicycleComponentManager.sol";
import {BicycleComponentManagerUI} from "../../../src/BicycleComponentManagerUI.sol";
import {BicycleComponents} from "../../../src/BicycleComponents.sol";
import {CamRoot} from "cam/src/CamRoot.sol";

contract BikeNftDeploymentHarness is BikeNftContractDeployment, BikeNftUIDeployment {
    struct Deployment {
        CamRoot camRoot;
        BicycleComponents components;
        BicycleComponentManager manager;
        BicycleComponentManagerUI ui;
    }

    function prepareUI(address manager) external returns (BicycleComponentManagerUI) {
        return deployBikeNftUI(manager);
    }

    function activateUI(CamRoot root, BicycleComponentManagerUI ui) external {
        bindBikeNftUI(root, ui);
    }

    function sourceUICodeHash(address manager) external returns (bytes32) {
        return bikeNftUISourceCodeHash(manager);
    }

    function deployFixture(ContractSettings memory settings) external returns (Deployment memory deployment) {
        Contracts memory business = deployBikeNftContracts(settings, address(this));
        configureBikeNftContracts(business, settings, address(this));
        nominateBikeNftAdmins(business, settings, address(this));
        deployment.components = business.components;
        deployment.manager = business.manager;
        deployment.ui = deployBikeNftUI(address(business.manager));
        deployment.camRoot = new CamRoot(address(this), "ipfs://fixture", bytes32(0));
        deployment.camRoot.setContractAddress("BicycleComponents", address(business.components));
        deployment.camRoot.setContractAddress("BicycleComponentManager", address(business.manager));
        bindBikeNftUI(deployment.camRoot, deployment.ui);
        deployment.camRoot.transferOwnership(address(0x11));
    }
}

contract BikeNftDeploymentTest is Test {
    address private constant CAM_ROOT_OWNER = address(0x11);
    address private constant REGISTRAR_ONE = address(0x18);
    address private constant REGISTRAR_TWO = address(0x19);
    BikeNftDeploymentHarness private harness;

    function setUp() external {
        harness = new BikeNftDeploymentHarness();
    }

    function testReplacementUIIsInactiveUntilExplicitBinding() external {
        BikeNftDeploymentHarness.Deployment memory deployment = harness.deployFixture(_settings());
        BicycleComponentManagerUI replacement = harness.prepareUI(address(deployment.manager));
        assertEq(deployment.camRoot.contractAddress("BicycleComponentManagerUI"), address(deployment.ui));
        assertEq(address(replacement.manager()), address(deployment.manager));
        assertEq(harness.sourceUICodeHash(address(deployment.manager)), address(replacement).codehash);
        harness.activateUI(deployment.camRoot, replacement);
        assertEq(deployment.camRoot.contractAddress("BicycleComponentManagerUI"), address(replacement));
        assertEq(deployment.camRoot.contractAddress("BicycleComponentManager"), address(deployment.manager));
        assertEq(deployment.camRoot.contractAddress("BicycleComponents"), address(deployment.components));
        assertEq(deployment.camRoot.owner(), address(harness));
        assertEq(deployment.camRoot.pendingOwner(), CAM_ROOT_OWNER);
        vm.etch(address(replacement), hex"00");
        assertNotEq(harness.sourceUICodeHash(address(deployment.manager)), address(replacement).codehash);
    }

    function testBusinessWithEmptyBasePreservesIndependentTokenMetadataAndOwnerGating() external {
        BikeNftContractDeployment.ContractSettings memory settings = _settings();
        settings.baseTokenURI = "";
        BikeNftDeploymentHarness.Deployment memory deployment = harness.deployFixture(settings);
        assertEq(deployment.components.baseURI(), "");
        address owner = address(0xB001);
        string memory httpsURI = "https://metadata.example.test/independent-component.json";
        string memory inlineURI = 'data:application/json,{"name":"Independent component"}';
        vm.startPrank(REGISTRAR_ONE);
        (, uint256 first) = deployment.manager.registerComponent(owner, "FULL-HTTPS", httpsURI);
        (, uint256 second) = deployment.manager.registerComponent(owner, "INLINE-JSON", inlineURI);
        vm.stopPrank();
        assertEq(deployment.components.tokenURI(first), httpsURI);
        assertEq(deployment.components.tokenURI(second), inlineURI);
        vm.expectRevert(
            abi.encodeWithSelector(
                BicycleComponentManager.Unauthorized.selector,
                address(this),
                keccak256(bytes("FULL-HTTPS")),
                deployment.manager.CAP_UPDATE_METADATA()
            )
        );
        deployment.manager.setComponentMetadata("FULL-HTTPS", inlineURI);
        assertEq(deployment.components.tokenURI(first), httpsURI);
        vm.prank(owner);
        deployment.manager.setComponentMetadata("FULL-HTTPS", inlineURI);
        assertEq(deployment.components.tokenURI(first), inlineURI);
    }

    function testBusinessConfigurationDoesNotRegisterOrMintSeedComponents() external {
        vm.recordLogs();
        BikeNftDeploymentHarness.Deployment memory deployment = harness.deployFixture(_settings());
        Vm.Log[] memory logs = vm.getRecordedLogs();
        bytes32 registered = BicycleComponentManager.ComponentRegistered.selector;
        bytes32 transfer = keccak256("Transfer(address,address,uint256)");

        for (uint256 i = 0; i < logs.length; i++) {
            bool isRegistration = logs[i].emitter == address(deployment.manager) && logs[i].topics.length != 0
                && logs[i].topics[0] == registered;
            bool isMint = logs[i].emitter == address(deployment.components) && logs[i].topics.length == 4
                && logs[i].topics[0] == transfer && logs[i].topics[1] == bytes32(0);
            assertFalse(isRegistration, "business configuration registered a seeded component");
            assertFalse(isMint, "business configuration minted a seeded component");
        }
    }

    function _settings() private pure returns (BikeNftContractDeployment.ContractSettings memory settings) {
        settings.tokenName = "Bicycle Components";
        settings.tokenSymbol = "BIKE";
        settings.baseTokenURI = "https://example.test/bike/tokens/";
        settings.collectionURI = "https://example.test/bike/collection.json";
        settings.intendedComponentsAdmin = address(0x12);
        settings.componentsAdminDelay = 1 days;
        settings.componentsPauser = address(0x13);
        settings.componentsConfigurer = address(0x14);
        settings.intendedManagerAdmin = address(0x15);
        settings.managerAdminDelay = 1 days;
        settings.managerPauser = address(0x16);
        settings.managerConfigurer = address(0x17);
        settings.registrars = new address[](2);
        settings.registrars[0] = REGISTRAR_ONE;
        settings.registrars[1] = REGISTRAR_TWO;
    }
}
