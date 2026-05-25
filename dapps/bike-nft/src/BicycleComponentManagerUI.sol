pragma solidity 0.8.35;

/// @notice Read-only subset of BicycleComponentManager used by the CAM UI helper.
/// @dev Kept local on purpose: this is not a separate protocol boundary. The
/// frontend consumes the UI helper ABI; this interface only keeps the helper
/// decoupled from manager implementation details and write/admin functions.
interface IBicycleComponentManagerView {
    enum ComponentStatus {
        None,
        Active,
        Missing,
        Retired
    }

    struct ComponentView {
        bool exists;
        bytes32 serialHash;
        address tokenContract;
        uint256 tokenId;
        address owner;
        address registrar;
        ComponentStatus status;
        string tokenURI;
        uint48 registeredAt;
        uint48 updatedAt;
        string serialNumber;
    }

    function defaultComponents() external view returns (address);

    function accountInfo(address account) external view returns (string memory);

    function canRegister(address actor) external view returns (bool);

    function componentBySerial(string calldata serialNumber) external view returns (ComponentView memory view_);

    function permissionsOf(address actor, string calldata serialNumber) external view returns (uint64 capabilities);

    function canUpdateMetadata(address actor, string calldata serialNumber) external view returns (bool);

    function canMarkMissing(address actor, string calldata serialNumber) external view returns (bool);

    function canClearMissing(address actor, string calldata serialNumber) external view returns (bool);

    function canRetire(address actor, string calldata serialNumber) external view returns (bool);
}

/// @title BicycleComponentManagerUI
/// @notice Read-only CAM route helper for BicycleComponentManager.
/// @dev
/// This contract is intentionally not part of the authorization path:
///
/// - it has no roles;
/// - it has no owner;
/// - it has no write functions;
/// - it never calls manager write functions;
/// - it never forwards user actions;
/// - it only reads manager state and returns route-level screen URIs.
///
/// CAM screens should send state-changing transactions directly to
/// BicycleComponentManager. The manager remains the source of truth for all
/// permissions and state changes.
contract BicycleComponentManagerUI {
    IBicycleComponentManagerView public immutable manager;

    string private constant SCREEN_ENTRY = "./screens/entry.json";
    string private constant SCREEN_COMPONENT = "./screens/component.json";
    string private constant SCREEN_REGISTER = "./screens/register.json";

    struct AccountView {
        address account;
        bool canRegister;
        string accountInfo;
    }

    struct ComponentScreenView {
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
    }

    struct RegisterScreenView {
        bool canRegister;
        bool exists;
        bytes32 serialHash;
        uint256 tokenId;
        address defaultComponents;
        string serialNumber;
        string accountInfo;
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

    /// @notice Route helper for the application entry screen.
    /// @dev First return value is always the CAM screen URI.
    function viewEntry(address account)
        external
        view
        returns (string memory screenURI, AccountView memory accountView)
    {
        accountView = _accountView(account);
        screenURI = SCREEN_ENTRY;
    }

    /// @notice Route helper for a component lookup/detail screen.
    /// @dev First return value is always the CAM screen URI.
    function viewComponent(string calldata serialNumber, address account)
        external
        view
        returns (string memory screenURI, ComponentScreenView memory component, AccountView memory accountView)
    {
        screenURI = SCREEN_COMPONENT;
        accountView = _accountView(account);

        if (_isEmpty(serialNumber)) {
            component.serialNumber = serialNumber;
            return (screenURI, component, accountView);
        }

        component = _componentView(serialNumber, account);
    }

    /// @notice Route helper for the registration screen.
    /// @dev First return value is always the CAM screen URI.
    function viewRegister(string calldata serialNumber, address account)
        external
        view
        returns (string memory screenURI, RegisterScreenView memory registerView, AccountView memory accountView)
    {
        screenURI = SCREEN_REGISTER;
        accountView = _accountView(account);
        registerView.canRegister = accountView.canRegister;
        registerView.defaultComponents = manager.defaultComponents();
        registerView.serialNumber = serialNumber;
        registerView.accountInfo = accountView.accountInfo;

        if (_isEmpty(serialNumber)) {
            return (screenURI, registerView, accountView);
        }

        IBicycleComponentManagerView.ComponentView memory component = manager.componentBySerial(serialNumber);
        registerView.exists = component.exists;
        registerView.serialHash = component.serialHash;
        registerView.tokenId = component.tokenId;
    }

    function _accountView(address account) internal view returns (AccountView memory view_) {
        view_.account = account;

        if (account != address(0)) {
            view_.canRegister = manager.canRegister(account);
            view_.accountInfo = manager.accountInfo(account);
        }
    }

    function _componentView(string calldata serialNumber, address account)
        internal
        view
        returns (ComponentScreenView memory view_)
    {
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

        if (!component.exists) {
            return view_;
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
