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
    string private constant VIEW_COMPONENT_FOUND = "component.found";
    string private constant VIEW_COMPONENT_NOT_FOUND = "component.notFound";
    string private constant VIEW_REGISTER_EMPTY = "register.empty";
    string private constant VIEW_REGISTER_READY = "register.ready";
    string private constant VIEW_REGISTER_BLOCKED = "register.blocked";

    string private constant ACTION_LOOKUP_COMPONENT = "lookupComponent";
    string private constant ACTION_OPEN_REGISTER = "openRegister";
    string private constant ACTION_REGISTER_COMPONENT = "registerComponent";
    string private constant ACTION_UPDATE_COMPONENT_METADATA = "updateComponentMetadata";
    string private constant ACTION_MARK_COMPONENT_MISSING = "markComponentMissing";
    string private constant ACTION_CLEAR_COMPONENT_MISSING = "clearComponentMissing";
    string private constant ACTION_RETIRE_COMPONENT = "retireComponent";

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
        IBicycleComponentManagerView.ComponentStatus status;
        string tokenURI;
        uint48 registeredAt;
        uint48 updatedAt;
        string serialNumber;
        uint64 permissions;
        bool isOwner;
        bool canUpdateMetadata;
        bool canMarkMissing;
        bool canClearMissing;
        bool canRetire;
        address componentsAddress;
    }

    error ZeroAddress();
    error ManagerHasNoCode(address managerAddress);
    error DoesNotAcceptPayments();
    error UnknownFunction(bytes4 selector);

    constructor(address managerAddress) {
        if (managerAddress == address(0)) revert ZeroAddress();
        if (managerAddress.code.length == 0) revert ManagerHasNoCode(managerAddress);

        manager = IBicycleComponentManagerView(managerAddress);
    }

    /// @notice Route projection for the application entry view.
    function viewEntry(address account) external view returns (AppView memory view_) {
        _setAccountView(view_, account);
        view_.viewId = VIEW_ENTRY;
        view_.serialNumber = "";
        view_.actions = _lookupAndRegisterActions();
    }

    /// @notice Route projection for component lookup and detail views.
    function viewComponent(string calldata serialNumber, address account) external view returns (AppView memory view_) {
        _setAccountView(view_, account);

        if (_isEmpty(serialNumber)) {
            view_.viewId = VIEW_COMPONENT_EMPTY;
            view_.serialNumber = serialNumber;
            view_.actions = _lookupAndRegisterActions();
            return view_;
        }

        _setComponentView(view_, serialNumber, account);
        view_.viewId = view_.exists ? VIEW_COMPONENT_FOUND : VIEW_COMPONENT_NOT_FOUND;
        view_.actions = view_.exists ? _componentActions(view_) : _lookupAndRegisterActions();
    }

    /// @notice Route projection for component registration views.
    function viewRegister(string calldata serialNumber, address account) external view returns (AppView memory view_) {
        _setAccountView(view_, account);
        view_.componentsAddress = manager.componentsAddress();
        view_.serialNumber = serialNumber;
        view_.tokenURI = "";

        if (_isEmpty(serialNumber)) {
            view_.viewId = VIEW_REGISTER_EMPTY;
            view_.actions = _lookupAndRegisterActions();
            return view_;
        }

        IBicycleComponentManagerView.ComponentView memory component = manager.componentBySerial(serialNumber);
        view_.exists = component.exists;
        view_.serialHash = component.serialHash;
        view_.tokenId = component.tokenId;

        if (view_.canRegister && !view_.exists) {
            view_.viewId = VIEW_REGISTER_READY;
            view_.actions = _registerReadyActions();
        } else {
            view_.viewId = VIEW_REGISTER_BLOCKED;
            view_.actions = _lookupOnlyActions();
        }
    }

    function _setAccountView(AppView memory view_, address account) internal view {
        view_.account = account;

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
        view_.status = component.status;
        view_.tokenURI = component.tokenURI;
        view_.registeredAt = component.registeredAt;
        view_.updatedAt = component.updatedAt;
        view_.serialNumber = component.exists ? component.serialNumber : serialNumber;

        // Intentional default: an unknown component returns only serialNumber
        // and exists=false. The route chooses a not-found screen for that
        // state, so zero/empty sentinel fields are not meant for display.
        if (!component.exists) {
            return;
        }

        if (component.owner != address(0)) {
            view_.ownerInfo = manager.accountInfo(component.owner);
        }

        if (account != address(0)) {
            view_.permissions = manager.permissionsOf(account, serialNumber);
            view_.isOwner = component.owner == account;
            view_.canUpdateMetadata = manager.canUpdateMetadata(account, serialNumber);
            view_.canMarkMissing = manager.canMarkMissing(account, serialNumber);
            view_.canClearMissing = manager.canClearMissing(account, serialNumber);
            view_.canRetire = manager.canRetire(account, serialNumber);
        }
    }

    function _lookupAndRegisterActions() internal pure returns (string[] memory actions) {
        actions = new string[](2);
        actions[0] = ACTION_LOOKUP_COMPONENT;
        actions[1] = ACTION_OPEN_REGISTER;
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
