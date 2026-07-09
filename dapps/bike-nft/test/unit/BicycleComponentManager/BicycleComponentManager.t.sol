pragma solidity 0.8.35;

import {IAccessControl} from "@openzeppelin-contracts-5.6.1/access/IAccessControl.sol";
import {Pausable} from "@openzeppelin-contracts-5.6.1/utils/Pausable.sol";

import "../../../src/BicycleComponentManager.sol";
import "../../../src/BicycleComponentManagerUI.sol";
import "../../../src/BicycleComponents.sol";
import "../../../src/IBicycleComponentManagerView.sol";
import "../../support/BicycleComponentManagerTestSupport.sol";

/// @dev Unit coverage for the manager's core authorization and state
/// transitions. Scenario tests cover longer app stories; this file keeps each
/// manager boundary small enough that a failing assertion points at one rule.
contract BicycleComponentManagerTest is BicycleComponentManagerTestSupport {
    BicycleComponents private components;
    BicycleComponentManager private manager;
    BicycleComponentManagerUI private ui;

    address private admin = address(this);
    address private registrar = address(0x1001);
    address private owner = address(0x2001);
    address private secondOwner = address(0x2002);
    address private delegate = address(0x3001);
    address private stranger = address(0x4001);

    string private constant SERIAL = "BIKE-FRAME-001";
    string private constant SECOND_SERIAL = "BIKE-WHEEL-002";
    string private constant TOKEN_URI = "fixture://bike-nft/components/frame-001.json";
    string private constant UPDATED_TOKEN_URI = "fixture://bike-nft/components/frame-001-updated.json";
    string private constant REPORT_URI = "fixture://bike-nft/reports/frame-001-missing.json";
    string private constant RESOLUTION_URI = "fixture://bike-nft/reports/frame-001-recovered.json";

    event ComponentReported(
        bytes32 indexed serialHash,
        address indexed tokenContract,
        address indexed reporter,
        uint256 tokenId,
        string serialNumber,
        string reportURI
    );

    event ComponentReportResolved(
        bytes32 indexed serialHash,
        address indexed tokenContract,
        address indexed resolver,
        uint256 tokenId,
        string serialNumber,
        string resolutionURI
    );

    /// @dev Each test starts with one configured component collection and one
    /// read-only UI helper. The manager must own minting and metadata rights on
    /// the collection before registration can exercise the real dependency.
    function setUp() external {
        components = new BicycleComponents("Bike Components", "BIKE", admin, 0, "", "");
        manager = new BicycleComponentManager(admin, 0, address(components));
        ui = new BicycleComponentManagerUI(address(manager));

        components.grantRole(components.MINTER_ROLE(), address(manager));
        components.grantRole(components.TOKEN_URI_SETTER_ROLE(), address(manager));

        manager.grantRole(manager.REGISTRAR_ROLE(), registrar);
    }

    /// @dev The manager and UI should never become value sinks or generic
    /// receivers. Low-level calls keep this boundary independent from ABI
    /// typing and assert the exact contract-owned error surface.
    function test_managerAndUiRejectNativeValueAndUnknownCalls() external {
        vm.deal(address(this), 4 wei);

        (bool managerReceiveOk, bytes memory managerReceiveError) = address(manager).call{value: 1 wei}("");
        assertFalse(managerReceiveOk, "manager should reject direct native value");
        assertEq(
            managerReceiveError,
            abi.encodeWithSelector(BicycleComponentManager.DoesNotAcceptPayments.selector),
            "manager receive error"
        );

        (bool managerFallbackOk, bytes memory managerFallbackError) = address(manager).call(hex"deadbeef");
        assertFalse(managerFallbackOk, "manager should reject unknown selectors");
        assertEq(
            managerFallbackError,
            abi.encodeWithSelector(BicycleComponentManager.UnknownFunction.selector, bytes4(hex"deadbeef")),
            "manager fallback error"
        );

        (bool uiReceiveOk, bytes memory uiReceiveError) = address(ui).call{value: 1 wei}("");
        assertFalse(uiReceiveOk, "UI should reject direct native value");
        assertEq(
            uiReceiveError,
            abi.encodeWithSelector(BicycleComponentManagerUI.DoesNotAcceptPayments.selector),
            "UI receive error"
        );

        (bool uiFallbackOk, bytes memory uiFallbackError) = address(ui).call(hex"deadbeef");
        assertFalse(uiFallbackOk, "UI should reject unknown selectors");
        assertEq(
            uiFallbackError,
            abi.encodeWithSelector(BicycleComponentManagerUI.UnknownFunction.selector, bytes4(hex"deadbeef")),
            "UI fallback error"
        );

        assertEq(address(manager).balance, 0, "manager should not retain native value");
        assertEq(address(ui).balance, 0, "UI should not retain native value");
    }

    /// @dev Registration is the root write path. It must reject non-registrars,
    /// mint the deterministic component token, store the manager record, expose
    /// the same data through the view interface, and reject serial reuse.
    function test_registrationRequiresRegistrarAndManagerViewsReflectTokenState() external {
        uint256 expectedTokenId = manager.tokenIdOf(SERIAL);
        bytes32 expectedSerialHash = manager.serialHashOf(SERIAL);
        bytes32 registrarRole = manager.REGISTRAR_ROLE();

        vm.prank(stranger);
        vm.expectRevert(
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, stranger, registrarRole)
        );
        manager.registerComponent(owner, SERIAL, TOKEN_URI);

        vm.prank(registrar);
        vm.expectRevert(BicycleComponentManager.ZeroAddress.selector);
        manager.registerComponent(address(0), SERIAL, TOKEN_URI);

        vm.prank(registrar);
        vm.expectRevert();
        manager.registerComponent(address(ui), SECOND_SERIAL, TOKEN_URI);
        assertFalse(manager.isRegistered(SECOND_SERIAL), "failed safe mint must not register component");

        vm.prank(registrar);
        (address tokenContract, uint256 tokenId) = manager.registerComponent(owner, SERIAL, TOKEN_URI);

        assertEq(tokenContract, address(components), "component contract mismatch");
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
        assertEq(component.missingReportURI, "", "active component should not have a missing report");
        assertEq(component.serialNumber, SERIAL, "component view serial mismatch");

        vm.prank(registrar);
        vm.expectRevert(
            abi.encodeWithSelector(
                BicycleComponentManager.ComponentAlreadyRegistered.selector, manager.serialHashOf(SERIAL)
            )
        );
        manager.registerComponent(secondOwner, SERIAL, TOKEN_URI);
    }

    /// @dev The UI helper is deliberately read-only, but its returned view IDs
    /// and actions are protocol data consumed by the CAM manifest. This test
    /// pins the state-to-view mapping without depending on a renderer.
    function test_uiRouteProjectionSelectsViewsAndValidActions() external {
        assertTrue(
            manager.supportsInterface(type(IBicycleComponentManagerView).interfaceId),
            "manager should advertise UI view interface"
        );

        BicycleComponentManagerUI.AppView memory view_ = ui.viewEntry(registrar);
        assertEq(view_.viewId, VIEW_ENTRY, "entry view mismatch");
        assertEq(view_.account, registrar, "entry account mismatch");
        assertTrue(view_.canRegister, "entry account should be allowed to register");
        assertEntryActions(view_.actions);

        view_ = ui.viewEntry(address(0));
        assertEq(view_.viewId, VIEW_ENTRY, "anonymous entry view mismatch");
        assertFalse(view_.canRegister, "anonymous entry should not claim registrar authority");
        assertLookupOnly(view_.actions);

        view_ = ui.viewEntry(owner);
        assertEq(view_.viewId, VIEW_ENTRY, "connected non-registrar entry view mismatch");
        assertFalse(view_.canRegister, "connected non-registrar entry should not claim registrar authority");
        assertConnectedEntryActions(view_.actions);

        view_ = ui.viewComponent("", owner);
        assertEq(view_.viewId, VIEW_COMPONENT_EMPTY, "empty component view mismatch");
        assertLookupOnly(view_.actions);

        view_ = ui.viewComponent("", address(0));
        assertEq(view_.viewId, VIEW_COMPONENT_EMPTY, "anonymous empty component view mismatch");
        assertLookupOnly(view_.actions);

        view_ = ui.viewComponent(SERIAL, owner);
        assertEq(view_.viewId, VIEW_COMPONENT_NOT_FOUND, "missing component view mismatch");
        assertEq(view_.serialNumber, SERIAL, "missing component serial mismatch");
        assertLookupOnly(view_.actions);

        view_ = ui.viewComponent(SERIAL, address(0));
        assertEq(view_.viewId, VIEW_COMPONENT_NOT_FOUND, "anonymous missing component view mismatch");
        assertEq(view_.serialNumber, SERIAL, "anonymous missing component serial mismatch");
        assertLookupOnly(view_.actions);

        view_ = ui.viewRegister("", registrar);
        assertEq(view_.viewId, VIEW_REGISTER_EMPTY, "empty register view mismatch");
        assertLookupAndRegisterActions(view_.actions);

        view_ = ui.viewRegister("", address(0));
        assertEq(view_.viewId, VIEW_REGISTER_EMPTY, "anonymous empty register view mismatch");
        assertLookupOnly(view_.actions);

        view_ = ui.viewRegister(SERIAL, registrar);
        assertEq(view_.viewId, VIEW_REGISTER_READY, "ready register view mismatch");
        assertEq(view_.componentsAddress, address(components), "register component address mismatch");
        assertRegisterReadyActions(view_.actions);

        view_ = ui.viewRegister(SERIAL, stranger);
        assertEq(view_.viewId, VIEW_REGISTER_BLOCKED, "unauthorized register view mismatch");
        assertLookupOnly(view_.actions);

        registerDefaultComponent();

        view_ = ui.viewComponent(SERIAL, owner);
        assertEq(view_.viewId, VIEW_COMPONENT_ACTIVE, "active component view mismatch");
        assertEq(view_.tokenURI, TOKEN_URI, "found component token URI mismatch");
        assertEq(view_.statusId, "active", "found component semantic status mismatch");
        assertActiveOwnerActions(view_.actions);

        vm.prank(owner);
        manager.markComponentMissing(SERIAL, REPORT_URI);

        view_ = ui.viewComponent(SERIAL, owner);
        assertEq(view_.viewId, VIEW_COMPONENT_MISSING, "missing component view mismatch");
        assertEq(view_.statusId, "missing", "missing component semantic status mismatch");
        assertEq(view_.missingReportURI, REPORT_URI, "missing component report URI mismatch");
        assertMissingOwnerActions(view_.actions);

        view_ = ui.viewRegister(SERIAL, registrar);
        assertEq(view_.viewId, VIEW_REGISTER_BLOCKED, "registered component register view mismatch");
        assertLookupOnly(view_.actions);
    }

    /// @dev The UI adapter only makes static calls, but its constructor should
    /// still fail fast when wired to the wrong contract. Otherwise a bad local
    /// deployment looks healthy until the first CAM route call.
    function test_uiConstructorRejectsUnsupportedManagerContract() external {
        vm.expectRevert(
            abi.encodeWithSelector(BicycleComponentManagerUI.ManagerUnsupported.selector, address(components))
        );
        new BicycleComponentManagerUI(address(components));
    }

    /// @dev Component collection rotation should affect only future
    /// registrations. Existing records keep their original token contract so
    /// historic component lookups remain stable across configuration changes.
    function test_configurerCanChangeComponentAddressForFutureRegistrationsOnly() external {
        registerDefaultComponent();

        BicycleComponents secondComponents = new BicycleComponents("Bike Components 2", "BIKE2", admin, 0, "", "");
        secondComponents.grantRole(secondComponents.MINTER_ROLE(), address(manager));
        secondComponents.grantRole(secondComponents.TOKEN_URI_SETTER_ROLE(), address(manager));
        bytes32 configurerRole = manager.CONFIGURER_ROLE();

        vm.prank(stranger);
        vm.expectRevert(
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, stranger, configurerRole)
        );
        manager.setComponentsAddress(address(secondComponents));

        vm.expectRevert(BicycleComponentManager.ZeroAddress.selector);
        manager.setComponentsAddress(address(0));

        vm.expectRevert(abi.encodeWithSelector(BicycleComponentManager.ComponentsHasNoCode.selector, address(0xdead)));
        manager.setComponentsAddress(address(0xdead));

        manager.setComponentsAddress(address(secondComponents));
        assertEq(manager.componentsAddress(), address(secondComponents), "component address mismatch");

        vm.prank(registrar);
        (address tokenContract, uint256 tokenId) = manager.registerComponent(secondOwner, SECOND_SERIAL, TOKEN_URI);

        assertEq(tokenContract, address(secondComponents), "future registration should use new component contract");
        assertEq(secondComponents.ownerOf(tokenId), secondOwner, "new component owner mismatch");
        assertEq(
            manager.componentBySerial(SERIAL).tokenContract,
            address(components),
            "existing record should keep original component contract"
        );
    }

    /// @dev The manager reads through the component collection for owner and
    /// token URI data. This fixture proves those dependency failures propagate
    /// instead of silently returning stale or zero-valued manager data.
    function test_registeredComponentViewsPropagateTokenReadFailures() external {
        RevertingReadComponents failingComponents = new RevertingReadComponents();
        manager.setComponentsAddress(address(failingComponents));

        vm.prank(registrar);
        manager.registerComponent(owner, SECOND_SERIAL, TOKEN_URI);

        IBicycleComponentManagerView.ComponentView memory component = manager.componentBySerial(SECOND_SERIAL);
        assertEq(component.owner, owner, "component owner mismatch before read failure");
        assertEq(component.tokenURI, TOKEN_URI, "component URI mismatch before read failure");

        failingComponents.setRevertReads(true);

        vm.expectRevert(RevertingReadComponents.ReadsDisabled.selector);
        manager.ownerOf(SECOND_SERIAL);

        vm.expectRevert(RevertingReadComponents.ReadsDisabled.selector);
        manager.componentBySerial(SECOND_SERIAL);
    }

    /// @dev Empty serials are rejected at every manager boundary that derives a
    /// serial hash. The UI may represent empty input as a route state, but the
    /// manager must never register or query it as a real component identity.
    function test_emptySerialNumberIsRejectedAtManagerBoundary() external {
        uint64 updateMetadataCapability = manager.CAP_UPDATE_METADATA();

        vm.expectRevert(BicycleComponentManager.EmptySerialNumber.selector);
        manager.serialHashOf("");

        vm.expectRevert(BicycleComponentManager.EmptySerialNumber.selector);
        manager.tokenIdOf("");

        vm.expectRevert(BicycleComponentManager.EmptySerialNumber.selector);
        manager.componentBySerial("");

        vm.expectRevert(BicycleComponentManager.EmptySerialNumber.selector);
        manager.isRegistered("");

        vm.expectRevert(BicycleComponentManager.EmptySerialNumber.selector);
        manager.tokenReference("");

        vm.expectRevert(BicycleComponentManager.EmptySerialNumber.selector);
        manager.ownerOf("");

        vm.expectRevert(BicycleComponentManager.EmptySerialNumber.selector);
        manager.componentURI("");

        vm.expectRevert(BicycleComponentManager.EmptySerialNumber.selector);
        manager.componentStatus("");

        vm.expectRevert(BicycleComponentManager.EmptySerialNumber.selector);
        manager.missingStatus("");

        vm.expectRevert(BicycleComponentManager.EmptySerialNumber.selector);
        manager.componentDelegation("", delegate);

        vm.expectRevert(BicycleComponentManager.EmptySerialNumber.selector);
        manager.permissionsOf(owner, "");

        vm.expectRevert(BicycleComponentManager.EmptySerialNumber.selector);
        manager.canUpdateMetadata(owner, "");

        vm.expectRevert(BicycleComponentManager.EmptySerialNumber.selector);
        manager.canMarkMissing(owner, "");

        vm.expectRevert(BicycleComponentManager.EmptySerialNumber.selector);
        manager.canClearMissing(owner, "");

        vm.expectRevert(BicycleComponentManager.EmptySerialNumber.selector);
        manager.canRetire(owner, "");

        vm.prank(registrar);
        vm.expectRevert(BicycleComponentManager.EmptySerialNumber.selector);
        manager.registerComponent(owner, "", TOKEN_URI);

        vm.expectRevert(BicycleComponentManager.EmptySerialNumber.selector);
        manager.setComponentMetadata("", TOKEN_URI);

        vm.expectRevert(BicycleComponentManager.EmptySerialNumber.selector);
        manager.markComponentMissing("", REPORT_URI);

        vm.expectRevert(BicycleComponentManager.EmptySerialNumber.selector);
        manager.clearComponentMissing("", RESOLUTION_URI);

        vm.expectRevert(BicycleComponentManager.EmptySerialNumber.selector);
        manager.retireComponent("");

        vm.expectRevert(BicycleComponentManager.EmptySerialNumber.selector);
        manager.setComponentDelegate("", delegate, updateMetadataCapability, uint48(block.timestamp + 1 days));

        vm.expectRevert(BicycleComponentManager.EmptySerialNumber.selector);
        manager.revokeComponentDelegate("", delegate);
    }

    /// @dev Component metadata is the registry's user-readable evidence
    /// pointer. Empty strings would create verified records or updates that
    /// indexers cannot resolve.
    function test_emptyComponentMetadataUriIsRejectedAtManagerBoundary() external {
        vm.prank(registrar);
        vm.expectRevert(BicycleComponentManager.EmptyTokenURI.selector);
        manager.registerComponent(owner, SERIAL, "");

        registerDefaultComponent();

        vm.prank(owner);
        vm.expectRevert(BicycleComponentManager.EmptyTokenURI.selector);
        manager.setComponentMetadata(SERIAL, "");
    }

    /// @dev Delegation is capability- and owner-scoped. This test checks the
    /// full lifecycle that makes delegations safe: unauthorized users fail,
    /// owners and active delegates can write, expiry removes power at the
    /// boundary timestamp, and token transfer invalidates old-owner grants.
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

    /// @dev Delegations are deliberately narrow grants. This pins the whole
    /// setup envelope so future changes cannot quietly turn delegation into a
    /// looser authorization side channel.
    function test_delegationSetupRejectsInvalidGrantEnvelope() external {
        registerDefaultComponent();

        bytes32 serialHash = manager.serialHashOf(SERIAL);
        uint64 updateMetadataCapability = manager.CAP_UPDATE_METADATA();
        uint64 unknownCapability = manager.VALID_CAPABILITY_MASK() | (1 << 8);
        uint48 validUntil = uint48(block.timestamp + 1 days);
        uint48 expiresNow = uint48(block.timestamp);
        uint48 expiresTooLate = uint48(block.timestamp + manager.maxDelegationDuration() + 1);

        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(BicycleComponentManager.Unauthorized.selector, stranger, serialHash, 0));
        manager.setComponentDelegate(SERIAL, delegate, updateMetadataCapability, validUntil);

        vm.prank(owner);
        vm.expectRevert(BicycleComponentManager.ZeroAddress.selector);
        manager.setComponentDelegate(SERIAL, address(0), updateMetadataCapability, validUntil);

        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(BicycleComponentManager.InvalidCapabilityMask.selector, 0));
        manager.setComponentDelegate(SERIAL, delegate, 0, validUntil);

        vm.prank(owner);
        vm.expectRevert(
            abi.encodeWithSelector(BicycleComponentManager.InvalidCapabilityMask.selector, unknownCapability)
        );
        manager.setComponentDelegate(SERIAL, delegate, unknownCapability, validUntil);

        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(BicycleComponentManager.InvalidDelegationExpiry.selector, expiresNow));
        manager.setComponentDelegate(SERIAL, delegate, updateMetadataCapability, expiresNow);

        vm.prank(owner);
        vm.expectRevert(
            abi.encodeWithSelector(BicycleComponentManager.InvalidDelegationExpiry.selector, expiresTooLate)
        );
        manager.setComponentDelegate(SERIAL, delegate, updateMetadataCapability, expiresTooLate);

        vm.prank(owner);
        vm.expectRevert(BicycleComponentManager.ZeroAddress.selector);
        manager.revokeComponentDelegate(SERIAL, address(0));
    }

    /// @dev Delegation expiry validation is subtraction-based, so the
    /// configured duration is policy only; even extreme durations cannot turn
    /// later grants into Solidity arithmetic panics as time advances.
    function test_delegationExpiryValidationIsOverflowProof() external {
        registerDefaultComponent();

        uint64 updateMetadataCapability = manager.CAP_UPDATE_METADATA();
        uint48 now_ = uint48(block.timestamp);
        uint48 maxDuration = 10;

        vm.expectRevert(
            abi.encodeWithSelector(BicycleComponentManager.InvalidDelegationExpiry.selector, uint48(0))
        );
        manager.setMaxDelegationDuration(0);

        manager.setMaxDelegationDuration(maxDuration);

        vm.prank(owner);
        manager.setComponentDelegate(SERIAL, delegate, updateMetadataCapability, now_ + maxDuration);

        vm.prank(owner);
        vm.expectRevert(
            abi.encodeWithSelector(BicycleComponentManager.InvalidDelegationExpiry.selector, now_ + maxDuration + 1)
        );
        manager.setComponentDelegate(SERIAL, delegate, updateMetadataCapability, now_ + maxDuration + 1);

        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(BicycleComponentManager.InvalidDelegationExpiry.selector, now_));
        manager.setComponentDelegate(SERIAL, delegate, updateMetadataCapability, now_);

        uint48 nearEnvelopeDuration = type(uint48).max - now_;
        manager.setMaxDelegationDuration(nearEnvelopeDuration);
        vm.warp(block.timestamp + 1);

        vm.prank(owner);
        manager.setComponentDelegate(SERIAL, delegate, updateMetadataCapability, type(uint48).max);

        manager.setMaxDelegationDuration(type(uint48).max);
        vm.prank(owner);
        manager.setComponentDelegate(SERIAL, delegate, updateMetadataCapability, type(uint48).max);
    }

    /// @dev Manager timestamps are stored as uint48. Once the chain timestamp
    /// exceeds that envelope, writes must fail with a manager-owned error
    /// rather than silently wrapping recorded times.
    function test_managerTimestampWritesRejectOutOfRangeBlockTime() external {
        registerDefaultComponent();

        uint256 tooLate = uint256(type(uint48).max) + 1;
        uint64 updateMetadataCapability = manager.CAP_UPDATE_METADATA();
        manager.setMaxDelegationDuration(type(uint48).max);

        vm.prank(owner);
        manager.setComponentDelegate(SERIAL, delegate, updateMetadataCapability, type(uint48).max);

        vm.warp(tooLate);

        vm.prank(registrar);
        vm.expectRevert(abi.encodeWithSelector(BicycleComponentManager.TimestampOutOfRange.selector, tooLate));
        manager.registerComponent(secondOwner, SECOND_SERIAL, TOKEN_URI);
        assertFalse(manager.isRegistered(SECOND_SERIAL), "out-of-range registration must not persist");

        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(BicycleComponentManager.TimestampOutOfRange.selector, tooLate));
        manager.setComponentMetadata(SERIAL, UPDATED_TOKEN_URI);
        assertEq(components.tokenURI(manager.tokenIdOf(SERIAL)), TOKEN_URI, "failed metadata write must roll back");

        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(BicycleComponentManager.TimestampOutOfRange.selector, tooLate));
        manager.markComponentMissing(SERIAL, REPORT_URI);
        assertEq(
            uint8(manager.componentStatus(SERIAL)),
            uint8(IBicycleComponentManagerView.ComponentStatus.Active),
            "failed status write must roll back"
        );

        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(BicycleComponentManager.TimestampOutOfRange.selector, tooLate));
        manager.setComponentDelegate(SERIAL, delegate, updateMetadataCapability, type(uint48).max);

        vm.prank(delegate);
        vm.expectRevert(abi.encodeWithSelector(BicycleComponentManager.TimestampOutOfRange.selector, tooLate));
        manager.setComponentMetadata(SERIAL, UPDATED_TOKEN_URI);
    }

    /// @dev Missing/retired status updates are separate capabilities. The test
    /// exercises owner writes first, then delegate writes with the exact
    /// capability mask needed for the status transitions.
    function test_ownerAndDelegatesCanMoveThroughMissingAndRetiredStatuses() external {
        registerDefaultComponent();
        bytes32 serialHash = manager.serialHashOf(SERIAL);
        uint256 tokenId = manager.tokenIdOf(SERIAL);
        uint64 markMissingCapability = manager.CAP_MARK_MISSING();
        uint64 clearMissingCapability = manager.CAP_CLEAR_MISSING();
        uint64 retireCapability = manager.CAP_RETIRE();

        vm.prank(owner);
        vm.expectEmit(true, true, true, true, address(manager));
        emit ComponentReported(serialHash, address(components), owner, tokenId, SERIAL, REPORT_URI);
        manager.markComponentMissing(SERIAL, REPORT_URI);
        assertEq(
            uint8(manager.componentStatus(SERIAL)),
            uint8(IBicycleComponentManagerView.ComponentStatus.Missing),
            "component should be missing"
        );
        assertFalse(manager.canRetire(owner, SERIAL), "missing report must be resolved before retirement");

        vm.prank(owner);
        vm.expectRevert(
            abi.encodeWithSelector(
                BicycleComponentManager.InvalidStatus.selector, IBicycleComponentManagerView.ComponentStatus.Missing
            )
        );
        manager.retireComponent(SERIAL);

        vm.prank(owner);
        vm.expectEmit(true, true, true, true, address(manager));
        emit ComponentReportResolved(serialHash, address(components), owner, tokenId, SERIAL, RESOLUTION_URI);
        manager.clearComponentMissing(SERIAL, RESOLUTION_URI);
        assertEq(
            uint8(manager.componentStatus(SERIAL)),
            uint8(IBicycleComponentManagerView.ComponentStatus.Active),
            "component should be active again"
        );

        uint64 capabilities = markMissingCapability | clearMissingCapability | retireCapability;
        vm.prank(owner);
        manager.setComponentDelegate(SERIAL, delegate, capabilities, uint48(block.timestamp + 1 days));

        vm.prank(delegate);
        manager.markComponentMissing(SERIAL, REPORT_URI);
        assertTrue(manager.missingStatus(SERIAL), "delegate should mark missing");
        assertEq(manager.componentBySerial(SERIAL).missingReportURI, REPORT_URI, "missing report should be visible");

        vm.prank(delegate);
        manager.clearComponentMissing(SERIAL, RESOLUTION_URI);
        assertFalse(manager.missingStatus(SERIAL), "delegate should clear missing");
        assertEq(manager.componentBySerial(SERIAL).missingReportURI, "", "missing report should clear on resolution");

        vm.prank(delegate);
        manager.retireComponent(SERIAL);
        assertEq(
            uint8(manager.componentStatus(SERIAL)),
            uint8(IBicycleComponentManagerView.ComponentStatus.Retired),
            "component should be retired"
        );
    }

    /// @dev Missing and recovery reports are external documents referenced by
    /// URI. Empty strings would create irreversible status events that cannot
    /// be interpreted by users, indexers, or recovery agents.
    function test_missingLifecycleRequiresReportAndResolutionUris() external {
        registerDefaultComponent();
        bytes32 serialHash = manager.serialHashOf(SERIAL);
        uint64 markMissingCapability = manager.CAP_MARK_MISSING();
        uint64 clearMissingCapability = manager.CAP_CLEAR_MISSING();

        vm.expectRevert(BicycleComponentManager.EmptySerialNumber.selector);
        manager.markComponentMissing("", "");

        vm.prank(stranger);
        vm.expectRevert(
            abi.encodeWithSelector(
                BicycleComponentManager.Unauthorized.selector, stranger, serialHash, markMissingCapability
            )
        );
        manager.markComponentMissing(SERIAL, "");

        vm.prank(owner);
        vm.expectRevert(BicycleComponentManager.EmptyLifecycleURI.selector);
        manager.markComponentMissing(SERIAL, "");

        vm.prank(owner);
        manager.markComponentMissing(SERIAL, REPORT_URI);

        vm.expectRevert(
            abi.encodeWithSelector(BicycleComponentManager.ComponentNotRegistered.selector, manager.serialHashOf(SECOND_SERIAL))
        );
        manager.clearComponentMissing(SECOND_SERIAL, "");

        vm.prank(stranger);
        vm.expectRevert(
            abi.encodeWithSelector(
                BicycleComponentManager.Unauthorized.selector, stranger, serialHash, clearMissingCapability
            )
        );
        manager.clearComponentMissing(SERIAL, "");

        vm.prank(owner);
        vm.expectRevert(BicycleComponentManager.EmptyLifecycleURI.selector);
        manager.clearComponentMissing(SERIAL, "");
    }

    /// @dev Pause is an emergency write gate on the manager. The test samples
    /// representative registry writes before and after unpause rather than
    /// duplicating every paused revert path in this unit file.
    function test_pausedManagerRejectsRegistryWrites() external {
        manager.pause();

        vm.prank(registrar);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        manager.registerComponent(owner, SERIAL, TOKEN_URI);

        manager.unpause();

        vm.prank(registrar);
        manager.registerComponent(owner, SERIAL, TOKEN_URI);

        manager.pause();

        vm.prank(owner);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        manager.markComponentMissing(SERIAL, REPORT_URI);
    }

    /// @dev Most tests need the same active component baseline. Keeping the
    /// helper private avoids turning scenario setup into a reusable abstraction
    /// with hidden assumptions about owner, registrar, and token URI.
    function registerDefaultComponent() private {
        vm.prank(registrar);
        manager.registerComponent(owner, SERIAL, TOKEN_URI);
    }
}

/// @dev Minimal component-collection double used only to force read failures.
/// It implements the manager-facing surface but intentionally rejects unrelated
/// ERC721 approval calls so tests do not accidentally depend on fake behavior.
contract RevertingReadComponents is IBicycleComponents {
    error ReadsDisabled();
    error TokenAlreadyExists(uint256 tokenId);
    error TokenDoesNotExist(uint256 tokenId);
    error UnsupportedFixtureCall();
    error WrongTokenOwner(address from, uint256 tokenId);
    error ZeroAddress();

    string private constant COLLECTION_NAME = "Failing Bike Components";
    string private constant COLLECTION_SYMBOL = "FBIKE";
    string private constant BASE_URI = "fixture://bike-nft/failing-components/";
    string private constant CONTRACT_URI = "fixture://bike-nft/failing-components.json";

    bool private _revertReads;
    mapping(uint256 tokenId => address owner) private _owners;
    mapping(uint256 tokenId => string uri) private _uris;
    mapping(address owner => uint256 balance) private _balances;

    function setRevertReads(bool revertReads) external {
        _revertReads = revertReads;
    }

    function mint(address to, uint256 tokenId, string calldata uri) external {
        _mint(to, tokenId, uri);
    }

    function safeMint(address to, uint256 tokenId, string calldata uri, bytes calldata) external {
        _mint(to, tokenId, uri);
    }

    function setTokenURI(uint256 tokenId, string calldata uri) external {
        _requireOwner(tokenId);
        _uris[tokenId] = uri;
    }

    function exists(uint256 tokenId) external view returns (bool) {
        return _owners[tokenId] != address(0);
    }

    function baseURI() external pure returns (string memory) {
        return BASE_URI;
    }

    function contractURI() external pure returns (string memory) {
        return CONTRACT_URI;
    }

    function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
        return interfaceId == type(IBicycleComponents).interfaceId;
    }

    function balanceOf(address owner_) external view returns (uint256) {
        return _balances[owner_];
    }

    function ownerOf(uint256 tokenId) external view returns (address) {
        if (_revertReads) revert ReadsDisabled();
        return _requireOwner(tokenId);
    }

    function safeTransferFrom(address from, address to, uint256 tokenId, bytes calldata) external {
        _transfer(from, to, tokenId);
    }

    function safeTransferFrom(address from, address to, uint256 tokenId) external {
        _transfer(from, to, tokenId);
    }

    function transferFrom(address from, address to, uint256 tokenId) external {
        _transfer(from, to, tokenId);
    }

    function approve(address, uint256) external pure {
        revert UnsupportedFixtureCall();
    }

    function setApprovalForAll(address, bool) external pure {
        revert UnsupportedFixtureCall();
    }

    function getApproved(uint256) external pure returns (address) {
        revert UnsupportedFixtureCall();
    }

    function isApprovedForAll(address, address) external pure returns (bool) {
        revert UnsupportedFixtureCall();
    }

    function name() external pure returns (string memory) {
        return COLLECTION_NAME;
    }

    function symbol() external pure returns (string memory) {
        return COLLECTION_SYMBOL;
    }

    function tokenURI(uint256 tokenId) external view returns (string memory) {
        if (_revertReads) revert ReadsDisabled();
        _requireOwner(tokenId);
        return _uris[tokenId];
    }

    function _mint(address to, uint256 tokenId, string calldata uri) private {
        if (to == address(0)) revert ZeroAddress();
        if (_owners[tokenId] != address(0)) revert TokenAlreadyExists(tokenId);

        _owners[tokenId] = to;
        _balances[to] += 1;
        _uris[tokenId] = uri;
    }

    function _transfer(address from, address to, uint256 tokenId) private {
        if (to == address(0)) revert ZeroAddress();
        if (_requireOwner(tokenId) != from) revert WrongTokenOwner(from, tokenId);

        _owners[tokenId] = to;
        _balances[from] -= 1;
        _balances[to] += 1;
    }

    function _requireOwner(uint256 tokenId) private view returns (address owner_) {
        owner_ = _owners[tokenId];
        if (owner_ == address(0)) revert TokenDoesNotExist(tokenId);
    }
}
