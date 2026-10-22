pragma solidity 0.8.35;

import "../../../src/BicycleComponentManager.sol";
import "../../../src/BicycleComponentManagerUI.sol";
import "../../../src/BicycleComponents.sol";
import "../../support/BicycleComponentManagerTestSupport.sol";

/// @dev Proposed public preview ABI, synchronized with workshopView in the
/// test-only CAM fixture. Stored grant expiry and proposed expiry are distinct.
interface IWorkshopPreviewRoadmap {
    struct DelegationView {
        string viewId;
        string[] actions;
        address account;
        bool paused;
        bool componentTokenPaused;
        string serialNumber;
        address owner;
        bool isOwner;
        address delegate;
        address delegationGrantor;
        uint64 delegationCapabilities;
        uint48 delegationValidUntil;
        bool delegationActive;
        uint48 duration;
        uint48 maxDelegationDuration;
        uint48 validUntil;
    }
    function viewDelegation(string calldata serialNumber, address delegate, address account, uint48 duration)
        external view returns (DelegationView memory);
}

/// @dev Fresh deployment acceptance. This is not an RPC mock: ownership,
/// revocation, metadata and record collection migration use real contracts.
/// Missing roadmap entrypoints fail explicit assertions, not compilation.
contract BikeOwnerWorkflowRoadmapScenarioTest is BicycleComponentManagerTestSupport {
    BicycleComponents private original;
    BicycleComponentManager private manager;
    BicycleComponentManagerUI private ui;
    address private constant OWNER = address(0x101);
    address private constant WORKSHOP = address(0x202);
    address private constant BUYER = address(0x303);
    address private constant REGISTRAR = address(0x404);
    string private constant SERIAL = "OWNER-WORKFLOW-001";

    function setUp() external {
        vm.warp(2_000_000_000);
        original = new BicycleComponents("Workshop Components", "WCOMP", address(this), 0, "", "");
        manager = new BicycleComponentManager(address(this), 0, address(original));
        ui = new BicycleComponentManagerUI(address(manager));
        original.grantRole(original.MINTER_ROLE(), address(manager));
        original.grantRole(original.TOKEN_URI_SETTER_ROLE(), address(manager));
        manager.grantRole(manager.REGISTRAR_ROLE(), REGISTRAR);
        manager.setMaxDelegationDuration(30 days);
    }

    function test_registerGrantRepairRevokeAndHandoverFromFreshDeployment() external {
        vm.prank(REGISTRAR);
        (address collection, uint256 tokenId) = manager.registerComponent(OWNER, SERIAL, "fixture://original");
        assertEq(collection, address(original));
        uint48 expiry = uint48(block.timestamp + 1 hours);
        vm.prank(OWNER);
        manager.setComponentDelegate(SERIAL, WORKSHOP, 1, expiry);
        (address grantor, uint64 capabilities, uint48 validUntil, bool active) = manager.componentDelegation(SERIAL, WORKSHOP);
        assertEq(grantor, OWNER);
        assertEq(uint256(capabilities), 1);
        assertEq(uint256(validUntil), uint256(expiry));
        assertTrue(active);
        assertEq(original.getApproved(tokenId), address(0), "workshop grant is not NFT approval");
        assertFalse(original.isApprovedForAll(OWNER, WORKSHOP));
        vm.prank(WORKSHOP);
        manager.setComponentMetadata(SERIAL, "fixture://repaired");
        assertEq(original.tokenURI(tokenId), "fixture://repaired");
        lifecycle("decommissionComponent(string)");
        assertTrue(inactive(), "owner takes component out of service before reporting loss");
        vm.prank(OWNER);
        manager.markComponentMissing(SERIAL, "fixture://missing");
        assertTrue(manager.missingStatus(SERIAL));
        assertTrue(inactive(), "report does not reactivate an out-of-service component");
        lifecycle("reactivateComponent(string)");
        assertFalse(inactive());
        assertTrue(manager.missingStatus(SERIAL), "reactivation does not resolve the report");
        vm.prank(OWNER);
        manager.revokeComponentDelegate(SERIAL, WORKSHOP);
        assertEq(manager.permissionsOf(WORKSHOP, SERIAL), 0);
        vm.prank(OWNER);
        original.safeTransferFrom(OWNER, BUYER, tokenId);
        assertEq(manager.ownerOf(SERIAL), BUYER);
        assertEq(ui.viewComponent(SERIAL, BUYER).owner, BUYER);
        assertEq(manager.permissionsOf(OWNER, SERIAL), 0);
        assertTrue(manager.missingStatus(SERIAL), "transfer neither hides nor resolves a missing report");
        vm.prank(BUYER);
        manager.clearComponentMissing(SERIAL, "fixture://resolved-by-buyer");
        assertFalse(manager.missingStatus(SERIAL));
        assertFalse(inactive());
        assertTrue(hasAction(ui.viewComponent(SERIAL, BUYER).actions, "transferComponent"), "roadmap: new owner must have guided handover");
        assertTrue(hasAction(ui.viewComponent(SERIAL, BUYER).actions, "delegation"), "roadmap: new owner must manage workshops");
    }

    function test_ownerCanPreviewAnotherWorkshopWithoutImpersonatingIt() external {
        vm.prank(REGISTRAR);
        manager.registerComponent(OWNER, SERIAL, "fixture://original");
        vm.prank(OWNER);
        manager.setComponentDelegate(SERIAL, WORKSHOP, 3, uint48(block.timestamp + 2 hours));
        // Owner remains the actor while delegate selects the grant being read.
        // Duration is translated by the read projection into exact validUntil;
        // the renderer must not invent JS clock arithmetic.
        (bool ok, bytes memory result) = address(ui).staticcall(
            abi.encodeWithSignature("viewDelegation(string,address,address,uint48)", SERIAL, WORKSHOP, OWNER, uint48(1 hours))
        );
        assertTrue(ok, "roadmap missing: viewDelegation(serial,delegate,account,duration)");
        assertGt(result.length, 0, "workshop preview must return ABI view data");
        IWorkshopPreviewRoadmap.DelegationView memory preview = abi.decode(result, (IWorkshopPreviewRoadmap.DelegationView));
        assertEq(preview.delegate, WORKSHOP);
        assertEq(preview.owner, OWNER);
        assertEq(preview.account, OWNER, "preview actor remains connected owner");
        assertEq(preview.delegationGrantor, OWNER, "preview reads selected workshop grant");
        assertEq(uint256(preview.delegationCapabilities), 3, "preview must not show owner capability mask");
        assertEq(uint256(preview.delegationValidUntil), block.timestamp + 2 hours, "stored grant expiry differs from new preview duration");
        assertTrue(preview.delegationActive);
        assertEq(uint256(preview.duration), 1 hours);
        assertEq(uint256(preview.validUntil), block.timestamp + 1 hours, "new expiry comes from chain clock and requested duration");
        assertEq(uint256(preview.maxDelegationDuration), 30 days);
        for (uint256 i; i < 2; i++) {
            uint48 invalidDuration = i == 0 ? 0 : uint48(30 days + 1);
            (bool accepted,) = address(ui).staticcall(abi.encodeCall(IWorkshopPreviewRoadmap.viewDelegation, (SERIAL, WORKSHOP, OWNER, invalidDuration)));
            assertFalse(accepted, "preview must reject zero or over-limit grant duration");
        }
        assertEq(manager.permissionsOf(OWNER, SERIAL) & 7, 7, "inspection must not switch the owner actor");
        assertEq(manager.permissionsOf(WORKSHOP, SERIAL), 3, "inspection must not alter grant");
    }

    function test_handoverUsesRecordedCollectionPauseNotCurrentRegistrationPause() external {
        vm.prank(REGISTRAR);
        (, uint256 tokenId) = manager.registerComponent(OWNER, SERIAL, "fixture://original");
        BicycleComponents replacement = new BicycleComponents("New Components", "NEW", address(this), 0, "", "");
        replacement.grantRole(replacement.MINTER_ROLE(), address(manager));
        replacement.grantRole(replacement.TOKEN_URI_SETTER_ROLE(), address(manager));
        manager.setComponentsAddress(address(replacement));
        replacement.pause();
        manager.pause(); // Registry pause is not an ERC721 transfer lock.
        BicycleComponentManagerUI.AppView memory view_ = ui.viewComponent(SERIAL, OWNER);
        assertEq(view_.tokenContract, address(original));
        assertFalse(view_.componentTokenPaused, "component projection must inspect recorded collection");
        assertTrue(hasAction(view_.actions, "transferComponent"), "registry/current collection pause must not hide available direct transfer");
        vm.prank(OWNER);
        original.safeTransferFrom(OWNER, BUYER, tokenId);
        assertEq(original.ownerOf(tokenId), BUYER);
        original.pause();
        assertFalse(hasAction(ui.viewComponent(SERIAL, BUYER).actions, "transferComponent"), "record collection pause must disable transfer");
    }

    function test_zeroRecipientRejectsWithoutChangingOwnerGrantOrMissingReport() external {
        vm.prank(REGISTRAR);
        (, uint256 tokenId) = manager.registerComponent(OWNER, SERIAL, "fixture://original");
        vm.prank(OWNER);
        manager.setComponentDelegate(SERIAL, WORKSHOP, 1, uint48(block.timestamp + 1 hours));
        vm.prank(OWNER);
        manager.markComponentMissing(SERIAL, "fixture://missing");
        vm.prank(OWNER);
        (bool ok,) = address(original).call(abi.encodeWithSignature("safeTransferFrom(address,address,uint256)", OWNER, address(0), tokenId));
        assertFalse(ok, "zero recipient must never receive ownership");
        assertEq(manager.ownerOf(SERIAL), OWNER);
        assertEq(manager.permissionsOf(WORKSHOP, SERIAL), 1);
        (address grantor, uint64 mask, uint48 expiry, bool active) = manager.componentDelegation(SERIAL, WORKSHOP);
        assertEq(grantor, OWNER);
        assertEq(uint256(mask), 1);
        assertEq(uint256(expiry), block.timestamp + 1 hours);
        assertTrue(active);
        assertTrue(manager.missingStatus(SERIAL));
        assertEq(manager.componentBySerial(SERIAL).missingReportURI, "fixture://missing");
    }

    function hasAction(string[] memory actions, string memory expected) private pure returns (bool) {
        for (uint256 i; i < actions.length; i++) {
            if (keccak256(bytes(actions[i])) == keccak256(bytes(expected))) return true;
        }
        return false;
    }

    function lifecycle(string memory signature) private {
        vm.prank(OWNER);
        (bool ok,) = address(manager).call(abi.encodeWithSignature(signature, SERIAL));
        assertTrue(ok, "roadmap missing: owner lifecycle transition");
    }

    function inactive() private view returns (bool) {
        (bool ok, bytes memory result) = address(manager).staticcall(abi.encodeWithSignature("inactiveStatus(string)", SERIAL));
        assertTrue(ok, "roadmap missing: independent inactiveStatus read");
        assertEq(result.length, 32);
        return abi.decode(result, (bool));
    }
}
