pragma solidity 0.8.35;

import {Test} from "forge-std-1.12.0/src/Test.sol";

import "../../../src/BicycleComponentManager.sol";
import "../../../src/BicycleComponents.sol";
import "../../../src/IBicycleComponentManagerView.sol";

contract BicycleComponentManagerTest is Test {
    BicycleComponents private components;
    BicycleComponentManager private manager;

    address private admin = address(this);
    address private registrar = address(0x1001);
    address private statusAttester = address(0x1002);
    address private owner = address(0x2001);
    address private secondOwner = address(0x2002);
    address private delegate = address(0x3001);
    address private stranger = address(0x4001);

    string private constant SERIAL = "BIKE-FRAME-001";
    string private constant TOKEN_URI = "fixture://bike-nft/components/frame-001.json";
    string private constant UPDATED_TOKEN_URI = "fixture://bike-nft/components/frame-001-updated.json";

    function setUp() external {
        components = new BicycleComponents("Bike Components", "BIKE", admin, 0, "", "");
        manager = new BicycleComponentManager(admin, 0, address(components));

        components.grantRole(components.MINTER_ROLE(), address(manager));
        components.grantRole(components.TOKEN_URI_SETTER_ROLE(), address(manager));

        manager.grantRole(manager.REGISTRAR_ROLE(), registrar);
        manager.grantRole(manager.STATUS_ATTESTER_ROLE(), statusAttester);
    }

    function test_registrationRequiresRegistrarAndManagerViewsReflectTokenState() external {
        uint256 expectedTokenId = manager.tokenIdOf(SERIAL);
        bytes32 expectedSerialHash = manager.serialHashOf(SERIAL);

        vm.prank(stranger);
        vm.expectRevert();
        manager.registerComponent(owner, SERIAL, TOKEN_URI);

        vm.prank(registrar);
        (address tokenContract, uint256 tokenId) = manager.registerComponent(owner, SERIAL, TOKEN_URI);

        assertEq(tokenContract, address(components), "default collection mismatch");
        assertEq(tokenId, expectedTokenId, "token id must derive from serial hash");
        assertEq(components.ownerOf(tokenId), owner, "component token owner mismatch");
        assertEq(components.tokenURI(tokenId), TOKEN_URI, "component token URI mismatch");
        assertTrue(manager.isRegistered(SERIAL), "manager should mark serial registered");

        IBicycleComponentManagerView.ComponentView memory component = manager.componentBySerial(SERIAL);
        assertTrue(component.exists, "component view should exist");
        assertEq(component.serialHash, expectedSerialHash, "serial hash mismatch");
        assertEq(component.tokenContract, address(components), "token contract mismatch");
        assertEq(component.tokenId, expectedTokenId, "component view token id mismatch");
        assertEq(component.owner, owner, "component view owner mismatch");
        assertEq(component.registrar, registrar, "component view registrar mismatch");
        assertEq(uint8(component.status), uint8(IBicycleComponentManagerView.ComponentStatus.Active), "status mismatch");
        assertEq(component.tokenURI, TOKEN_URI, "component view token URI mismatch");
        assertEq(component.serialNumber, SERIAL, "component view serial mismatch");

        vm.prank(registrar);
        vm.expectRevert(
            abi.encodeWithSelector(
                BicycleComponentManager.ComponentAlreadyRegistered.selector, manager.serialHashOf(SERIAL)
            )
        );
        manager.registerComponent(secondOwner, SERIAL, TOKEN_URI);
    }

    function test_emptySerialNumberIsRejectedAtManagerBoundary() external {
        vm.expectRevert(BicycleComponentManager.EmptySerialNumber.selector);
        manager.serialHashOf("");

        vm.expectRevert(BicycleComponentManager.EmptySerialNumber.selector);
        manager.tokenIdOf("");

        vm.expectRevert(BicycleComponentManager.EmptySerialNumber.selector);
        manager.componentBySerial("");

        vm.prank(registrar);
        vm.expectRevert(BicycleComponentManager.EmptySerialNumber.selector);
        manager.registerComponent(owner, "", TOKEN_URI);
    }

    function test_ownerAndDelegatesCanUpdateMetadataOnlyWhileAuthorizedAndBeforeExpiryOrTransfer() external {
        registerDefaultComponent();

        bytes32 serialHash = manager.serialHashOf(SERIAL);
        uint64 updateMetadataCapability = manager.CAP_UPDATE_METADATA();
        uint64 markMissingCapability = manager.CAP_MARK_MISSING();
        uint48 validUntil = uint48(block.timestamp + 1 days);

        vm.prank(stranger);
        vm.expectRevert(
            abi.encodeWithSelector(
                BicycleComponentManager.Unauthorized.selector, stranger, serialHash, updateMetadataCapability
            )
        );
        manager.setComponentMetadata(SERIAL, UPDATED_TOKEN_URI);

        vm.prank(owner);
        manager.setComponentMetadata(SERIAL, UPDATED_TOKEN_URI);
        assertEq(components.tokenURI(manager.tokenIdOf(SERIAL)), UPDATED_TOKEN_URI, "owner metadata update failed");

        vm.prank(owner);
        manager.setComponentDelegate(SERIAL, delegate, updateMetadataCapability, uint48(block.timestamp + 1 days));

        vm.prank(delegate);
        manager.setComponentMetadata(SERIAL, TOKEN_URI);
        assertEq(components.tokenURI(manager.tokenIdOf(SERIAL)), TOKEN_URI, "delegate metadata update failed");

        vm.prank(owner);
        manager.setComponentDelegate(SERIAL, delegate, markMissingCapability, validUntil);

        assertEq(manager.permissionsOf(delegate, SERIAL), markMissingCapability, "delegate should be active");

        vm.warp(validUntil);
        assertEq(manager.permissionsOf(delegate, SERIAL), 0, "delegate should expire at validUntil");

        vm.prank(owner);
        manager.setComponentDelegate(SERIAL, delegate, markMissingCapability, uint48(block.timestamp + 1 days));

        uint256 tokenId = manager.tokenIdOf(SERIAL);

        vm.prank(owner);
        components.transferFrom(owner, secondOwner, tokenId);

        assertEq(manager.permissionsOf(delegate, SERIAL), 0, "old-owner delegation must not survive transfer");
    }

    function test_ownerAndDelegatesCanMoveThroughMissingAndRetiredStatuses() external {
        registerDefaultComponent();
        uint64 markMissingCapability = manager.CAP_MARK_MISSING();
        uint64 clearMissingCapability = manager.CAP_CLEAR_MISSING();
        uint64 retireCapability = manager.CAP_RETIRE();

        vm.prank(owner);
        manager.markMissing(SERIAL);
        assertEq(
            uint8(manager.componentStatus(SERIAL)),
            uint8(IBicycleComponentManagerView.ComponentStatus.Missing),
            "component should be missing"
        );

        vm.prank(owner);
        manager.clearMissing(SERIAL);
        assertEq(
            uint8(manager.componentStatus(SERIAL)),
            uint8(IBicycleComponentManagerView.ComponentStatus.Active),
            "component should be active again"
        );

        uint64 capabilities = markMissingCapability | clearMissingCapability | retireCapability;
        vm.prank(owner);
        manager.setComponentDelegate(SERIAL, delegate, capabilities, uint48(block.timestamp + 1 days));

        vm.prank(delegate);
        manager.markMissing(SERIAL);
        assertTrue(manager.missingStatus(SERIAL), "delegate should mark missing");

        vm.prank(delegate);
        manager.clearMissing(SERIAL);
        assertFalse(manager.missingStatus(SERIAL), "delegate should clear missing");

        vm.prank(delegate);
        manager.retireComponent(SERIAL);
        assertEq(
            uint8(manager.componentStatus(SERIAL)),
            uint8(IBicycleComponentManagerView.ComponentStatus.Retired),
            "component should be retired"
        );
    }

    function test_pausedManagerRejectsRegistryWrites() external {
        manager.pause();

        vm.prank(registrar);
        vm.expectRevert();
        manager.registerComponent(owner, SERIAL, TOKEN_URI);

        manager.unpause();

        vm.prank(registrar);
        manager.registerComponent(owner, SERIAL, TOKEN_URI);

        manager.pause();

        vm.prank(owner);
        vm.expectRevert();
        manager.markMissing(SERIAL);
    }

    function test_onlyRegistrarOrStatusAttesterCanAddComponentAttestation() external {
        registerDefaultComponent();

        bytes32 serialHash = manager.serialHashOf(SERIAL);
        bytes32 attestationType = keccak256("inspection");

        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(BicycleComponentManager.Unauthorized.selector, stranger, serialHash, 0));
        manager.addComponentAttestation(SERIAL, attestationType, "fixture://attestations/unauthorized.json");

        vm.prank(registrar);
        manager.addComponentAttestation(SERIAL, attestationType, "fixture://attestations/registrar.json");

        vm.prank(statusAttester);
        manager.addComponentAttestation(SERIAL, attestationType, "fixture://attestations/status-attester.json");
    }

    function registerDefaultComponent() private {
        vm.prank(registrar);
        manager.registerComponent(owner, SERIAL, TOKEN_URI);
    }
}
