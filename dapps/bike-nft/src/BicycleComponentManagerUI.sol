pragma solidity 0.8.35;

import {IBicycleComponentManagerView} from "./IBicycleComponentManagerView.sol";

/// @title BicycleComponentManagerUI
/// @notice Read-only CAM route projection for BicycleComponentManager.
/// @dev
/// This contract is intentionally not part of the authorization path:
///
/// - it has no roles;
/// - it has no owner;
/// - it has no write functions;
/// - it never calls manager write functions;
/// - it never forwards user actions;
/// - it only reads manager state and returns semantic UI view data.
///
/// CAM write actions should target BicycleComponentManager directly. The
/// manager remains the source of truth for all
/// permissions and state changes.
contract BicycleComponentManagerUI {
    IBicycleComponentManagerView public immutable manager;

    string private constant VIEW_ENTRY = "entry";
    string private constant VIEW_COMPONENT_EMPTY = "component.empty";
    string private constant VIEW_COMPONENT_ACTIVE = "component.active";
    string private constant VIEW_COMPONENT_MISSING = "component.missing";
    string private constant VIEW_COMPONENT_RETIRED = "component.retired";
    string private constant VIEW_COMPONENT_NOT_FOUND = "component.notFound";
    string private constant VIEW_REGISTER_EMPTY = "register.empty";
    string private constant VIEW_REGISTER_READY = "register.ready";
    string private constant VIEW_REGISTER_BLOCKED = "register.blocked";

    string private constant ACTION_LOOKUP_COMPONENT = "lookupComponent";
    string private constant ACTION_OPEN_REGISTER = "openRegister";
    string private constant ACTION_SET_ACCOUNT_INFO = "setAccountInfo";
    string private constant ACTION_REGISTER_COMPONENT = "registerComponent";
    string private constant ACTION_UPDATE_COMPONENT_METADATA = "updateComponentMetadata";
    string private constant ACTION_MARK_COMPONENT_MISSING = "markComponentMissing";
    string private constant ACTION_CLEAR_COMPONENT_MISSING = "clearComponentMissing";
    string private constant ACTION_RETIRE_COMPONENT = "retireComponent";

    string private constant STATUS_NONE = "none";
    string private constant STATUS_ACTIVE = "active";
    string private constant STATUS_MISSING = "missing";
    string private constant STATUS_RETIRED = "retired";
    string private constant AUTHORITY_NONE = "none";
    string private constant AUTHORITY_OWNER = "owner";
    string private constant AUTHORITY_DELEGATE = "delegate";

    /// @notice Semantic view state consumed by the CAM UI schema.
    /// @dev
    /// `viewId` selects a manifest-owned UI node. `actions` selects manifest-owned
    /// action nodes that are valid for the returned onchain state. The contract
    /// does not return UI resource paths or layout fragments.
    struct AppView {
        string viewId;
        string[] actions;
        address account;
        bool canRegister;
        string accountInfo;
        bool exists;
        bytes32 serialHash;
        address tokenContract;
        uint256 tokenId;
        address owner;
        string ownerInfo;
        address registrar;
        string statusId;
        string tokenURI;
        string missingReportURI;
        uint48 registeredAt;
        uint48 updatedAt;
        string serialNumber;
        uint64 permissions;
        bool isOwner;
        string authorityId;
        address delegationGrantor;
        uint64 delegationCapabilities;
        uint48 delegationValidUntil;
        bool delegationActive;
        bool canUpdateMetadata;
        bool canMarkMissing;
        bool canClearMissing;
        bool canRetire;
        address componentsAddress;
    }

    error ZeroAddress();
    error ManagerHasNoCode(address managerAddress);
    error ManagerUnsupported(address managerAddress);
    error UnsupportedComponentStatus(IBicycleComponentManagerView.ComponentStatus status);
    error DoesNotAcceptPayments();
    error UnknownFunction(bytes4 selector);

    constructor(address managerAddress) {
        if (managerAddress == address(0)) revert ZeroAddress();
        if (managerAddress.code.length == 0) revert ManagerHasNoCode(managerAddress);
        try IBicycleComponentManagerView(managerAddress).supportsInterface(type(IBicycleComponentManagerView).interfaceId) returns (
            bool supported
        ) {
            if (!supported) revert ManagerUnsupported(managerAddress);
        } catch {
            revert ManagerUnsupported(managerAddress);
        }

        manager = IBicycleComponentManagerView(managerAddress);
    }

    /// @notice Route projection for the application entry view.
    function viewEntry(address account) external view returns (AppView memory view_) {
        _setBaseView(view_, account);
        view_.viewId = VIEW_ENTRY;
        view_.serialNumber = "";
        view_.actions = _entryActions(account, view_.canRegister);
    }

    /// @notice Route projection for component lookup and detail views.
    function viewComponent(string calldata serialNumber, address account) external view returns (AppView memory view_) {
        _setBaseView(view_, account);

        if (_isEmpty(serialNumber)) {
            view_.viewId = VIEW_COMPONENT_EMPTY;
            view_.serialNumber = serialNumber;
            view_.actions = _lookupAndRegisterActions(view_.canRegister);
            return view_;
        }

        _setComponentView(view_, serialNumber, account);
        if (!view_.exists) {
            view_.viewId = VIEW_COMPONENT_NOT_FOUND;
        }
        view_.actions = view_.exists ? _componentActions(view_) : _lookupAndRegisterActions(view_.canRegister);
    }

    /// @notice Route projection for component registration views.
    function viewRegister(string calldata serialNumber, address account) external view returns (AppView memory view_) {
        _setBaseView(view_, account);
        view_.componentsAddress = manager.componentsAddress();
        view_.serialNumber = serialNumber;
        view_.tokenURI = "";

        if (_isEmpty(serialNumber)) {
            view_.viewId = VIEW_REGISTER_EMPTY;
            view_.actions = _lookupAndRegisterActions(view_.canRegister);
            return view_;
        }

        IBicycleComponentManagerView.ComponentView memory component = manager.componentBySerial(serialNumber);
        view_.exists = component.exists;
        view_.serialHash = component.serialHash;
        view_.tokenId = component.tokenId;
        view_.statusId = _componentStatusId(component.status);

        if (view_.canRegister && !view_.exists) {
            view_.viewId = VIEW_REGISTER_READY;
            view_.actions = _registerReadyActions();
        } else {
            view_.viewId = VIEW_REGISTER_BLOCKED;
            view_.actions = _lookupOnlyActions();
        }
    }

    function _setBaseView(AppView memory view_, address account) internal view {
        view_.account = account;
        // The manager stores status as a Solidity enum, but CAM view data must
        // expose stable semantic IDs so generic renderers never decode ordinals.
        view_.statusId = _componentStatusId(IBicycleComponentManagerView.ComponentStatus.None);
        view_.authorityId = AUTHORITY_NONE;

        // Intentional default: address(0) leaves canRegister=false and
        // accountInfo="" through Solidity struct defaults. That is convenient
        // for unauthenticated views, but callers must treat it as "no account".
        if (account != address(0)) {
            view_.canRegister = manager.canRegister(account);
            view_.accountInfo = manager.accountInfo(account);
        }
    }

    function _setComponentView(AppView memory view_, string calldata serialNumber, address account) internal view {
        IBicycleComponentManagerView.ComponentView memory component = manager.componentBySerial(serialNumber);

        view_.exists = component.exists;
        view_.serialHash = component.serialHash;
        view_.tokenContract = component.tokenContract;
        view_.tokenId = component.tokenId;
        view_.owner = component.owner;
        view_.registrar = component.registrar;
        view_.statusId = _componentStatusId(component.status);
        view_.tokenURI = component.tokenURI;
        view_.missingReportURI = component.missingReportURI;
        view_.registeredAt = component.registeredAt;
        view_.updatedAt = component.updatedAt;
        view_.serialNumber = component.exists ? component.serialNumber : serialNumber;

        // Intentional default: an unknown component returns only serialNumber
        // and exists=false. The route chooses a not-found view for that state,
        // so zero/empty sentinel fields are not meant for display.
        if (!component.exists) {
            return;
        }

        view_.viewId = _componentViewId(component.status);

        if (component.owner != address(0)) {
            view_.ownerInfo = manager.accountInfo(component.owner);
        }

        if (account != address(0)) {
            view_.permissions = manager.permissionsOf(account, serialNumber);
            view_.isOwner = component.owner == account;
            (
                view_.delegationGrantor,
                view_.delegationCapabilities,
                view_.delegationValidUntil,
                view_.delegationActive
            ) = manager.componentDelegation(serialNumber, account);
            if (view_.isOwner || !view_.delegationActive) {
                view_.delegationGrantor = address(0);
                view_.delegationCapabilities = 0;
                view_.delegationValidUntil = 0;
                view_.delegationActive = false;
            }
            view_.authorityId = _authorityId(view_.isOwner, view_.delegationActive);
            view_.canUpdateMetadata = manager.canUpdateMetadata(account, serialNumber);
            view_.canMarkMissing = manager.canMarkMissing(account, serialNumber);
            view_.canClearMissing = manager.canClearMissing(account, serialNumber);
            view_.canRetire = manager.canRetire(account, serialNumber);
        }
    }

    function _componentStatusId(IBicycleComponentManagerView.ComponentStatus status)
        internal
        pure
        returns (string memory)
    {
        if (status == IBicycleComponentManagerView.ComponentStatus.None) return STATUS_NONE;
        if (status == IBicycleComponentManagerView.ComponentStatus.Active) return STATUS_ACTIVE;
        if (status == IBicycleComponentManagerView.ComponentStatus.Missing) return STATUS_MISSING;
        if (status == IBicycleComponentManagerView.ComponentStatus.Retired) return STATUS_RETIRED;

        revert UnsupportedComponentStatus(status);
    }

    function _componentViewId(IBicycleComponentManagerView.ComponentStatus status)
        internal
        pure
        returns (string memory)
    {
        if (status == IBicycleComponentManagerView.ComponentStatus.Active) return VIEW_COMPONENT_ACTIVE;
        if (status == IBicycleComponentManagerView.ComponentStatus.Missing) return VIEW_COMPONENT_MISSING;
        if (status == IBicycleComponentManagerView.ComponentStatus.Retired) return VIEW_COMPONENT_RETIRED;

        revert UnsupportedComponentStatus(status);
    }

    function _authorityId(bool isOwner, bool delegationActive) internal pure returns (string memory) {
        if (isOwner) return AUTHORITY_OWNER;
        if (delegationActive) return AUTHORITY_DELEGATE;
        return AUTHORITY_NONE;
    }

    function _lookupAndRegisterActions(bool canRegister) internal pure returns (string[] memory actions) {
        if (!canRegister) {
            return _lookupOnlyActions();
        }

        actions = new string[](2);
        actions[0] = ACTION_LOOKUP_COMPONENT;
        actions[1] = ACTION_OPEN_REGISTER;
    }

    function _entryActions(address account, bool canRegister) internal pure returns (string[] memory actions) {
        if (account == address(0)) {
            return _lookupOnlyActions();
        }

        if (!canRegister) {
            actions = new string[](2);
            actions[0] = ACTION_LOOKUP_COMPONENT;
            actions[1] = ACTION_SET_ACCOUNT_INFO;
            return actions;
        }

        actions = new string[](3);
        actions[0] = ACTION_LOOKUP_COMPONENT;
        actions[1] = ACTION_OPEN_REGISTER;
        actions[2] = ACTION_SET_ACCOUNT_INFO;
    }

    function _lookupOnlyActions() internal pure returns (string[] memory actions) {
        actions = new string[](1);
        actions[0] = ACTION_LOOKUP_COMPONENT;
    }

    function _registerReadyActions() internal pure returns (string[] memory actions) {
        actions = new string[](2);
        actions[0] = ACTION_REGISTER_COMPONENT;
        actions[1] = ACTION_LOOKUP_COMPONENT;
    }

    function _componentActions(AppView memory view_) internal pure returns (string[] memory actions) {
        uint256 count = 1;
        if (view_.canUpdateMetadata) count++;
        if (view_.canMarkMissing) count++;
        if (view_.canClearMissing) count++;
        if (view_.canRetire) count++;

        actions = new string[](count);
        uint256 index;

        actions[index++] = ACTION_LOOKUP_COMPONENT;
        if (view_.canUpdateMetadata) actions[index++] = ACTION_UPDATE_COMPONENT_METADATA;
        if (view_.canMarkMissing) actions[index++] = ACTION_MARK_COMPONENT_MISSING;
        if (view_.canClearMissing) actions[index++] = ACTION_CLEAR_COMPONENT_MISSING;
        if (view_.canRetire) actions[index++] = ACTION_RETIRE_COMPONENT;
    }

    function _isEmpty(string calldata value) internal pure returns (bool) {
        return bytes(value).length == 0;
    }

    receive() external payable {
        revert DoesNotAcceptPayments();
    }

    fallback() external payable {
        revert UnknownFunction(msg.sig);
    }
}
