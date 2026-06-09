pragma solidity 0.8.35;

import {IAccessControl} from "@openzeppelin-contracts-5.6.1/access/IAccessControl.sol";
import {Pausable} from "@openzeppelin-contracts-5.6.1/utils/Pausable.sol";

import "../../../src/BicycleComponentManager.sol";
import "../../../src/BicycleComponentManagerUI.sol";
import "../../../src/BicycleComponents.sol";
import "../../../src/IBicycleComponentManagerView.sol";
import "../../support/BicycleComponentManagerTestSupport.sol";

/// @dev Scenario coverage for user-facing lifecycle stories that cross manager,
/// component NFT, roles, delegations, and the read-only UI projection. These
/// tests intentionally read like app workflows; narrower authorization and
/// revert checks belong in the unit suite.
contract BicycleComponentManagerScenarioTest is BicycleComponentManagerTestSupport {
    BicycleComponents private components;
    BicycleComponentManager private manager;
    BicycleComponentManagerUI private ui;

    address private admin = address(this);
    address private registrar = address(0x1001);
    address private statusAttester = address(0x1002);
    address private owner = address(0x2001);
    address private buyer = address(0x2002);
    address private delegate = address(0x3001);
    address private stranger = address(0x4001);

    string private constant SERIAL = "SCENARIO-FRAME-001";
    string private constant SECOND_SERIAL = "SCENARIO-WHEEL-002";
    string private constant TOKEN_URI = "fixture://bike-nft/scenario/frame-001.json";
    string private constant UPDATED_TOKEN_URI = "fixture://bike-nft/scenario/frame-001-updated.json";
    string private constant SECOND_TOKEN_URI = "fixture://bike-nft/scenario/wheel-002.json";
    string private constant BUYER_INFO_URI = "fixture://bike-nft/accounts/buyer.json";
    string private constant SHOP_TOKEN_URI = "fixture://bike-nft/scenario/shop-updated-frame-001.json";
    string private constant OWNER_INFO_URI = "fixture://bike-nft/accounts/owner.json";
    string private constant REGISTRAR_ATTESTATION_URI = "fixture://bike-nft/attestations/registrar-inspection.json";
    string private constant STATUS_ATTESTATION_URI = "fixture://bike-nft/attestations/status-attester-inspection.json";

    event ComponentAttestationAdded(
        bytes32 indexed serialHash,
        bytes32 indexed attestationType,
        address indexed attester,
        address tokenContract,
        uint256 tokenId,
        string serialNumber,
        string attestationURI
    );

    /// @dev Scenarios start from the standard local app shape: one collection,
    /// one manager, one UI projection, and the two operational roles needed for
    /// registration/status provenance.
    function setUp() external {
        components = new BicycleComponents("Bike Components", "BIKE", admin, 0, "", "");
        manager = new BicycleComponentManager(admin, 0, address(components));
        ui = new BicycleComponentManagerUI(address(manager));

        components.grantRole(components.MINTER_ROLE(), address(manager));
        components.grantRole(components.TOKEN_URI_SETTER_ROLE(), address(manager));

        manager.grantRole(manager.REGISTRAR_ROLE(), registrar);
        manager.grantRole(manager.STATUS_ATTESTER_ROLE(), statusAttester);
    }

    // A happy-path registrar flow should keep the manager record, ERC721 token,
    // and read-only UI projection in lockstep across registration and metadata
    // update.
    function test_registrarRegistrationFlowKeepsManagerTokenAndUiProjectionAligned() external {
        BicycleComponentManagerUI.AppView memory view_ = ui.viewRegister(SERIAL, registrar);
        assertEq(view_.viewId, VIEW_REGISTER_READY, "registrar should see registration-ready view");
        assertEq(view_.componentsAddress, address(components), "registration view should expose active collection");
        assertRegisterReadyActions(view_.actions);

        vm.prank(registrar);
        (address tokenContract, uint256 tokenId) = manager.registerComponent(owner, SERIAL, TOKEN_URI);

        assertEq(tokenContract, address(components), "registered token contract mismatch");
        assertEq(tokenId, manager.tokenIdOf(SERIAL), "token id should be serial-derived");
        assertEq(components.ownerOf(tokenId), owner, "component owner mismatch");
        assertEq(components.tokenURI(tokenId), TOKEN_URI, "component token URI mismatch");

        view_ = ui.viewComponent(SERIAL, owner);
        assertEq(view_.viewId, VIEW_COMPONENT_FOUND, "component route should find registered component");
        assertEq(view_.owner, owner, "component view owner mismatch");
        assertEq(view_.tokenContract, address(components), "component view token contract mismatch");
        assertEq(view_.tokenId, tokenId, "component view token id mismatch");
        assertEq(view_.tokenURI, TOKEN_URI, "component view token URI mismatch");
        assertActiveOwnerActions(view_.actions);

        view_ = ui.viewRegister(SERIAL, registrar);
        assertEq(view_.viewId, VIEW_REGISTER_BLOCKED, "registered serial should no longer be registerable");
        assertLookupOnly(view_.actions);

        vm.prank(owner);
        manager.setComponentMetadata(SERIAL, UPDATED_TOKEN_URI);

        assertEq(components.tokenURI(tokenId), UPDATED_TOKEN_URI, "metadata update should hit the NFT contract");
        assertEq(ui.viewComponent(SERIAL, owner).tokenURI, UPDATED_TOKEN_URI, "UI route should show updated metadata");
    }

    // This is the compact lifecycle smoke test for the dapp-facing state
    // machine. It starts from empty/not-found route states, performs the real
    // manager writes, and checks that each state transition changes the UI
    // projection an agent would consume.
    function test_lookupRegisterMissingClearAndRetireLifecycleProjection() external {
        BicycleComponentManagerUI.AppView memory view_ = ui.viewComponent("", owner);
        assertEq(view_.viewId, VIEW_COMPONENT_EMPTY, "empty lookup should have its own view");
        assertEq(view_.serialNumber, "", "empty lookup should preserve the submitted serial");
        assertLookupAndRegisterActions(view_.actions);

        view_ = ui.viewRegister("", registrar);
        assertEq(view_.viewId, VIEW_REGISTER_EMPTY, "empty registration should have its own view");
        assertEq(view_.componentsAddress, address(components), "empty registration should expose collection address");
        assertLookupAndRegisterActions(view_.actions);

        vm.prank(registrar);
        vm.expectRevert(BicycleComponentManager.EmptySerialNumber.selector);
        manager.registerComponent(owner, "", TOKEN_URI);

        view_ = ui.viewComponent(SERIAL, owner);
        assertEq(view_.viewId, VIEW_COMPONENT_NOT_FOUND, "unknown serial should be not-found");
        assertFalse(view_.exists, "unknown serial must not be treated as a component");
        assertEq(view_.serialNumber, SERIAL, "not-found view should preserve lookup serial");
        assertLookupAndRegisterActions(view_.actions);

        vm.prank(registrar);
        manager.registerComponent(owner, SERIAL, TOKEN_URI);

        view_ = ui.viewComponent(SERIAL, owner);
        assertEq(view_.viewId, VIEW_COMPONENT_FOUND, "registered serial should be found");
        assertEq(
            uint8(manager.componentStatus(SERIAL)),
            uint8(IBicycleComponentManagerView.ComponentStatus.Active),
            "new component status"
        );
        assertEq(view_.statusId, "active", "new component semantic status");
        assertActiveOwnerActions(view_.actions);

        vm.prank(owner);
        manager.markMissing(SERIAL);

        view_ = ui.viewComponent(SERIAL, owner);
        assertEq(
            uint8(manager.componentStatus(SERIAL)),
            uint8(IBicycleComponentManagerView.ComponentStatus.Missing),
            "missing status should persist"
        );
        assertEq(view_.statusId, "missing", "missing semantic status should project");
        assertMissingOwnerActions(view_.actions);

        vm.prank(owner);
        manager.clearMissing(SERIAL);

        view_ = ui.viewComponent(SERIAL, owner);
        assertEq(
            uint8(manager.componentStatus(SERIAL)),
            uint8(IBicycleComponentManagerView.ComponentStatus.Active),
            "clear missing should restore active status"
        );
        assertEq(view_.statusId, "active", "clear missing should restore semantic active status");
        assertActiveOwnerActions(view_.actions);

        vm.prank(owner);
        manager.retireComponent(SERIAL);

        view_ = ui.viewComponent(SERIAL, owner);
        assertEq(
            uint8(manager.componentStatus(SERIAL)),
            uint8(IBicycleComponentManagerView.ComponentStatus.Retired),
            "retired status should persist"
        );
        assertEq(view_.statusId, "retired", "retired semantic status should project");
        assertLookupOnly(view_.actions);
    }

    // A used-bike sale is where ownership, delegation, status, account metadata,
    // and UI actions cross contract boundaries. The old owner/delegate must lose
    // control immediately when the ERC721 owner changes.
    function test_usedBikeSaleInvalidatesOldDelegationAndMovesUiControlToBuyer() external {
        registerDefaultComponent();
        uint256 tokenId = manager.tokenIdOf(SERIAL);
        uint64 allCapabilities = manager.VALID_CAPABILITY_MASK();

        vm.prank(buyer);
        manager.setAccountInfo(BUYER_INFO_URI);

        vm.prank(owner);
        manager.setComponentDelegate(SERIAL, delegate, allCapabilities, uint48(block.timestamp + 7 days));

        vm.prank(delegate);
        manager.markMissing(SERIAL);

        assertEq(
            uint8(manager.componentStatus(SERIAL)),
            uint8(IBicycleComponentManagerView.ComponentStatus.Missing),
            "delegate should mark component missing before sale"
        );
        assertMissingOwnerActions(ui.viewComponent(SERIAL, delegate).actions);

        vm.prank(owner);
        components.transferFrom(owner, buyer, tokenId);

        assertEq(manager.permissionsOf(delegate, SERIAL), 0, "old delegate must lose permissions after sale");
        assertEq(manager.permissionsOf(owner, SERIAL), 0, "old owner must lose permissions after sale");
        assertLookupOnly(ui.viewComponent(SERIAL, delegate).actions);

        BicycleComponentManagerUI.AppView memory buyerView = ui.viewComponent(SERIAL, buyer);
        assertEq(buyerView.owner, buyer, "buyer should become component owner");
        assertEq(buyerView.ownerInfo, BUYER_INFO_URI, "buyer profile should follow current owner");
        assertMissingOwnerActions(buyerView.actions);

        vm.prank(buyer);
        manager.clearMissing(SERIAL);
        assertActiveOwnerActions(ui.viewComponent(SERIAL, buyer).actions);

        vm.prank(buyer);
        manager.retireComponent(SERIAL);
        assertLookupOnly(ui.viewComponent(SERIAL, buyer).actions);
    }

    // Component collection rotation is a configuration lifecycle scenario:
    // existing records must keep their original token contract while future
    // registrations use the replacement collection.
    function test_componentCollectionRolloverPreservesOldRecordsAndUsesNewCollectionForFutureRegistrations() external {
        registerDefaultComponent();
        uint256 oldTokenId = manager.tokenIdOf(SERIAL);

        BicycleComponents nextComponents = new BicycleComponents("Next Bike Components", "NBIKE", admin, 0, "", "");
        nextComponents.grantRole(nextComponents.MINTER_ROLE(), address(manager));
        nextComponents.grantRole(nextComponents.TOKEN_URI_SETTER_ROLE(), address(manager));

        manager.setComponentsAddress(address(nextComponents));

        vm.prank(registrar);
        (address nextTokenContract, uint256 nextTokenId) =
            manager.registerComponent(buyer, SECOND_SERIAL, SECOND_TOKEN_URI);

        assertEq(nextTokenContract, address(nextComponents), "future registrations should use new collection");
        assertEq(nextComponents.ownerOf(nextTokenId), buyer, "new collection owner mismatch");

        BicycleComponentManagerUI.AppView memory oldView = ui.viewComponent(SERIAL, owner);
        BicycleComponentManagerUI.AppView memory newView = ui.viewComponent(SECOND_SERIAL, buyer);

        assertEq(oldView.tokenContract, address(components), "old record should keep original collection");
        assertEq(oldView.owner, owner, "old record owner mismatch");
        assertEq(newView.tokenContract, address(nextComponents), "new record should use replacement collection");
        assertEq(newView.owner, buyer, "new record owner mismatch");

        vm.prank(owner);
        manager.setComponentMetadata(SERIAL, UPDATED_TOKEN_URI);
        assertEq(
            components.tokenURI(oldTokenId), UPDATED_TOKEN_URI, "old metadata update should use original collection"
        );

        vm.prank(buyer);
        manager.setComponentMetadata(SECOND_SERIAL, UPDATED_TOKEN_URI);
        assertEq(
            nextComponents.tokenURI(nextTokenId),
            UPDATED_TOKEN_URI,
            "new metadata update should use replacement collection"
        );
    }

    // Repair-shop delegation is intentionally narrower than ownership. The UI
    // should expose only actions the temporary delegate can currently perform,
    // and expiry should remove those actions without changing component state.
    function test_repairShopDelegationAdvertisesOnlyCurrentCapabilitiesAndExpiresCleanly() external {
        registerDefaultComponent();

        uint64 inspectAndReportCapabilities = manager.CAP_UPDATE_METADATA() | manager.CAP_MARK_MISSING();
        uint48 validUntil = uint48(block.timestamp + 2 days);

        vm.prank(owner);
        manager.setComponentDelegate(SERIAL, delegate, inspectAndReportCapabilities, validUntil);

        assertActions(
            ui.viewComponent(SERIAL, delegate).actions,
            expectedActions(ACTION_LOOKUP_COMPONENT, ACTION_UPDATE_COMPONENT_METADATA, ACTION_MARK_COMPONENT_MISSING)
        );

        vm.prank(delegate);
        manager.setComponentMetadata(SERIAL, SHOP_TOKEN_URI);

        vm.prank(delegate);
        manager.markMissing(SERIAL);

        BicycleComponentManagerUI.AppView memory shopView = ui.viewComponent(SERIAL, delegate);
        assertEq(shopView.tokenURI, SHOP_TOKEN_URI, "delegate metadata should be visible");
        assertEq(
            uint8(manager.componentStatus(SERIAL)),
            uint8(IBicycleComponentManagerView.ComponentStatus.Missing),
            "delegate should move component to missing"
        );
        assertEq(shopView.statusId, "missing", "delegate missing semantic status");
        assertActions(shopView.actions, expectedActions(ACTION_LOOKUP_COMPONENT, ACTION_UPDATE_COMPONENT_METADATA));

        uint64 resolveAndCloseCapabilities = manager.CAP_CLEAR_MISSING() | manager.CAP_RETIRE();
        uint48 resolveAndCloseValidUntil = uint48(block.timestamp + 3 days);
        vm.prank(owner);
        manager.setComponentDelegate(SERIAL, delegate, resolveAndCloseCapabilities, resolveAndCloseValidUntil);

        assertActions(
            ui.viewComponent(SERIAL, delegate).actions,
            expectedActions(ACTION_LOOKUP_COMPONENT, ACTION_CLEAR_COMPONENT_MISSING, ACTION_RETIRE_COMPONENT)
        );

        vm.warp(resolveAndCloseValidUntil);

        assertEq(manager.permissionsOf(delegate, SERIAL), 0, "delegate permissions should expire");
        assertLookupOnly(ui.viewComponent(SERIAL, delegate).actions);
        assertEq(
            uint8(manager.componentStatus(SERIAL)),
            uint8(IBicycleComponentManagerView.ComponentStatus.Missing),
            "expiry must not alter component status"
        );
    }

    // Emergency pause should block representative state-changing manager paths
    // while preserving read routes for owners, agents, and humans diagnosing the
    // app.
    function test_emergencyPauseBlocksWritesButLeavesReadOnlyRoutesUsable() external {
        registerDefaultComponent();

        vm.prank(owner);
        manager.setAccountInfo(OWNER_INFO_URI);

        manager.pause();

        BicycleComponentManagerUI.AppView memory view_ = ui.viewComponent(SERIAL, owner);
        assertEq(view_.viewId, VIEW_COMPONENT_FOUND, "pause should not hide registered components");
        assertEq(view_.ownerInfo, OWNER_INFO_URI, "pause should not hide owner profile data");
        assertActiveOwnerActions(view_.actions);

        vm.prank(owner);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        manager.setComponentMetadata(SERIAL, UPDATED_TOKEN_URI);

        uint64 updateMetadataCapability = manager.CAP_UPDATE_METADATA();
        vm.prank(owner);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        manager.setComponentDelegate(SERIAL, delegate, updateMetadataCapability, uint48(block.timestamp + 1 days));

        vm.prank(owner);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        manager.setAccountInfo(BUYER_INFO_URI);

        vm.prank(registrar);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        manager.addComponentAttestation(SERIAL, keccak256("paused-inspection"), REGISTRAR_ATTESTATION_URI);

        manager.unpause();

        vm.prank(owner);
        manager.setComponentMetadata(SERIAL, UPDATED_TOKEN_URI);

        assertEq(ui.viewComponent(SERIAL, owner).tokenURI, UPDATED_TOKEN_URI, "writes should resume after unpause");
    }

    // Attestations are provenance events, not hidden component state. Official
    // notes from the registrar and status attester should emit stable evidence
    // while ownership, status, and timestamps remain unchanged.
    function test_officialAttestationsAreEventOnlyProvenanceAndDoNotMutateComponentState() external {
        registerDefaultComponent();

        bytes32 serialHash = manager.serialHashOf(SERIAL);
        uint256 tokenId = manager.tokenIdOf(SERIAL);
        bytes32 inspectionType = keccak256("inspection");

        IBicycleComponentManagerView.ComponentView memory beforeView = manager.componentBySerial(SERIAL);

        vm.expectEmit(true, true, true, true, address(manager));
        emit ComponentAttestationAdded(
            serialHash, inspectionType, registrar, address(components), tokenId, SERIAL, REGISTRAR_ATTESTATION_URI
        );
        vm.prank(registrar);
        manager.addComponentAttestation(SERIAL, inspectionType, REGISTRAR_ATTESTATION_URI);

        vm.expectEmit(true, true, true, true, address(manager));
        emit ComponentAttestationAdded(
            serialHash, inspectionType, statusAttester, address(components), tokenId, SERIAL, STATUS_ATTESTATION_URI
        );
        vm.prank(statusAttester);
        manager.addComponentAttestation(SERIAL, inspectionType, STATUS_ATTESTATION_URI);

        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(BicycleComponentManager.Unauthorized.selector, stranger, serialHash, 0));
        manager.addComponentAttestation(SERIAL, inspectionType, "fixture://bike-nft/attestations/forged.json");

        IBicycleComponentManagerView.ComponentView memory afterView = manager.componentBySerial(SERIAL);
        assertEq(afterView.owner, beforeView.owner, "attestation must not alter owner");
        assertEq(uint8(afterView.status), uint8(beforeView.status), "attestation must not alter status");
        assertEq(afterView.tokenURI, beforeView.tokenURI, "attestation must not alter token URI");
        assertEq(afterView.registeredAt, beforeView.registeredAt, "attestation must not alter registration time");
        assertEq(afterView.updatedAt, beforeView.updatedAt, "attestation must not alter update time");
    }

    // Registrar roles are operational state, not static manifest truth. The UI
    // should reflect offboarding immediately, and the manager should reject a
    // former registrar even if their old links or pages are still open.
    function test_registrarOffboardingImmediatelyChangesUiAndWriteAuthority() external {
        BicycleComponentManagerUI.AppView memory entryView = ui.viewEntry(registrar);
        assertEq(entryView.viewId, VIEW_ENTRY, "entry route mismatch");
        assertTrue(entryView.canRegister, "registrar should start active");
        assertLookupAndRegisterActions(entryView.actions);
        assertEq(ui.viewRegister(SECOND_SERIAL, registrar).viewId, VIEW_REGISTER_READY, "registrar should start ready");

        bytes32 registrarRole = manager.REGISTRAR_ROLE();
        manager.revokeRole(registrarRole, registrar);

        entryView = ui.viewEntry(registrar);
        assertFalse(entryView.canRegister, "offboarded registrar should lose entry capability");
        assertEq(
            ui.viewRegister(SECOND_SERIAL, registrar).viewId,
            VIEW_REGISTER_BLOCKED,
            "offboarded registrar should see blocked registration"
        );
        assertLookupOnly(ui.viewRegister(SECOND_SERIAL, registrar).actions);

        vm.prank(registrar);
        vm.expectRevert(
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, registrar, registrarRole)
        );
        manager.registerComponent(owner, SECOND_SERIAL, SECOND_TOKEN_URI);

        manager.grantRole(registrarRole, registrar);

        vm.prank(registrar);
        manager.registerComponent(owner, SECOND_SERIAL, SECOND_TOKEN_URI);

        assertEq(
            ui.viewComponent(SECOND_SERIAL, owner).viewId, VIEW_COMPONENT_FOUND, "restored registrar should register"
        );
    }

    // Revocation is a separate operational path from delegation expiry. A shop
    // can be cut off immediately without rolling back any legitimate work it
    // already performed.
    function test_ownerRevocationCutsOffDelegateImmediatelyWithoutChangingComponentState() external {
        registerDefaultComponent();

        uint64 allCapabilities = manager.VALID_CAPABILITY_MASK();
        vm.prank(owner);
        manager.setComponentDelegate(SERIAL, delegate, allCapabilities, uint48(block.timestamp + 30 days));

        vm.prank(delegate);
        manager.setComponentMetadata(SERIAL, SHOP_TOKEN_URI);

        vm.prank(owner);
        manager.revokeComponentDelegate(SERIAL, delegate);

        (address grantor, uint64 capabilities, uint48 validUntil, bool active) =
            manager.componentDelegation(SERIAL, delegate);
        assertEq(grantor, address(0), "revoked delegation grantor should clear");
        assertEq(capabilities, 0, "revoked delegation capabilities should clear");
        assertEq(validUntil, 0, "revoked delegation expiry should clear");
        assertFalse(active, "revoked delegation should be inactive");
        assertLookupOnly(ui.viewComponent(SERIAL, delegate).actions);

        uint64 markMissingCapability = manager.CAP_MARK_MISSING();
        bytes32 serialHash = manager.serialHashOf(SERIAL);
        vm.prank(delegate);
        vm.expectRevert(
            abi.encodeWithSelector(
                BicycleComponentManager.Unauthorized.selector, delegate, serialHash, markMissingCapability
            )
        );
        manager.markMissing(SERIAL);

        BicycleComponentManagerUI.AppView memory ownerView = ui.viewComponent(SERIAL, owner);
        assertEq(ownerView.tokenURI, SHOP_TOKEN_URI, "revocation should not roll back completed work");
        assertActiveOwnerActions(ownerView.actions);
    }

    // Retirement is final registry state even though the ERC721 remains
    // transferable. Later ownership/profile changes must not revive write
    // actions or mutable metadata paths.
    function test_retiredComponentStaysFinalAcrossLaterTransferAndProfileChanges() external {
        registerDefaultComponent();
        uint256 tokenId = manager.tokenIdOf(SERIAL);

        vm.prank(owner);
        manager.retireComponent(SERIAL);

        BicycleComponentManagerUI.AppView memory retiredOwnerView = ui.viewComponent(SERIAL, owner);
        assertEq(
            uint8(manager.componentStatus(SERIAL)),
            uint8(IBicycleComponentManagerView.ComponentStatus.Retired),
            "component should be retired"
        );
        assertEq(retiredOwnerView.statusId, "retired", "owner retired semantic status");
        assertLookupOnly(retiredOwnerView.actions);

        vm.prank(owner);
        components.transferFrom(owner, buyer, tokenId);

        vm.prank(buyer);
        manager.setAccountInfo(BUYER_INFO_URI);

        BicycleComponentManagerUI.AppView memory retiredBuyerView = ui.viewComponent(SERIAL, buyer);
        assertEq(retiredBuyerView.owner, buyer, "retired token should still transfer");
        assertEq(retiredBuyerView.ownerInfo, BUYER_INFO_URI, "retired view should follow current owner profile");
        assertEq(
            uint8(manager.componentStatus(SERIAL)),
            uint8(IBicycleComponentManagerView.ComponentStatus.Retired),
            "transfer must not revive retired status"
        );
        assertEq(retiredBuyerView.statusId, "retired", "transfer must not revive semantic status");
        assertLookupOnly(retiredBuyerView.actions);

        vm.prank(buyer);
        vm.expectRevert(
            abi.encodeWithSelector(
                BicycleComponentManager.InvalidStatus.selector, IBicycleComponentManagerView.ComponentStatus.Retired
            )
        );
        manager.setComponentMetadata(SERIAL, UPDATED_TOKEN_URI);

        vm.prank(buyer);
        vm.expectRevert(
            abi.encodeWithSelector(
                BicycleComponentManager.InvalidStatus.selector, IBicycleComponentManagerView.ComponentStatus.Retired
            )
        );
        manager.markMissing(SERIAL);
    }

    // The component-token contract is a real dependency, not a passive data
    // object. Pausing it should block mint/metadata writes while manager reads
    // and UI projections over already-minted components remain available.
    function test_componentTokenPauseBlocksTokenWritesButManagerReadRoutesStayAvailable() external {
        registerDefaultComponent();

        components.pause();

        BicycleComponentManagerUI.AppView memory view_ = ui.viewComponent(SERIAL, owner);
        assertEq(view_.viewId, VIEW_COMPONENT_FOUND, "token pause should not hide existing manager record");
        assertEq(view_.tokenURI, TOKEN_URI, "token pause should not hide token URI reads");

        vm.prank(registrar);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        manager.registerComponent(buyer, SECOND_SERIAL, SECOND_TOKEN_URI);

        vm.prank(owner);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        manager.setComponentMetadata(SERIAL, UPDATED_TOKEN_URI);

        components.unpause();

        vm.prank(owner);
        manager.setComponentMetadata(SERIAL, UPDATED_TOKEN_URI);

        vm.prank(registrar);
        manager.registerComponent(buyer, SECOND_SERIAL, SECOND_TOKEN_URI);

        assertEq(ui.viewComponent(SERIAL, owner).tokenURI, UPDATED_TOKEN_URI, "metadata write should resume");
        assertEq(ui.viewComponent(SECOND_SERIAL, buyer).viewId, VIEW_COMPONENT_FOUND, "minting should resume");
    }

    /// @dev Register the canonical scenario component through the registrar so
    /// follow-on workflows start from the same active manager/NFT state.
    function registerDefaultComponent() private {
        vm.prank(registrar);
        manager.registerComponent(owner, SERIAL, TOKEN_URI);
    }
}
