pragma solidity 0.8.35;

import {
    AccessControlDefaultAdminRules
} from "@openzeppelin-contracts-5.6.1/access/extensions/AccessControlDefaultAdminRules.sol";
import {Pausable} from "@openzeppelin-contracts-5.6.1/utils/Pausable.sol";
import {IERC165} from "@openzeppelin-contracts-5.6.1/utils/introspection/IERC165.sol";

import {IBicycleComponents} from "./IBicycleComponents.sol";
import {IBicycleComponentManagerView} from "./IBicycleComponentManagerView.sol";

/// @title BicycleComponentManager
/// @notice Registry and policy contract for bicycle component NFTs.
/// @dev
/// V1 keeps the ERC-721 token contract simple and transferable. This manager
/// stores the bicycle-specific registry state:
///
/// - serial number -> component NFT reference;
/// - verified registrar-created records;
/// - missing / retired status;
/// - owner-granted delegates for registry actions;
/// - account profile URIs.
///
/// The manager has one configured component-token contract for new
/// registrations. Each registered component stores its own `tokenContract`, so
/// changing the configured contract only affects future registrations.
contract BicycleComponentManager is AccessControlDefaultAdminRules, Pausable, IBicycleComponentManagerView {
    // ---------------------------------------------------------------------
    // Roles
    // ---------------------------------------------------------------------

    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");
    bytes32 public constant CONFIGURER_ROLE = keccak256("CONFIGURER_ROLE");
    bytes32 public constant REGISTRAR_ROLE = keccak256("REGISTRAR_ROLE");

    // ---------------------------------------------------------------------
    // Component-level delegation capabilities
    // ---------------------------------------------------------------------

    uint64 public constant CAP_UPDATE_METADATA = 1 << 0;
    uint64 public constant CAP_MARK_MISSING = 1 << 1;
    uint64 public constant CAP_CLEAR_MISSING = 1 << 2;
    uint64 public constant CAP_RETIRE = 1 << 3;

    uint64 public constant VALID_CAPABILITY_MASK =
        CAP_UPDATE_METADATA | CAP_MARK_MISSING | CAP_CLEAR_MISSING | CAP_RETIRE;

    uint48 public constant DEFAULT_MAX_DELEGATION_DURATION = 365 days;

    // ---------------------------------------------------------------------
    // Types
    // ---------------------------------------------------------------------

    struct ComponentRecord {
        bytes32 serialHash;
        address tokenContract;
        uint256 tokenId;
        address registrar;
        ComponentStatus status;
        string missingReportURI;
        uint48 registeredAt;
        uint48 updatedAt;
        string serialNumber;
    }

    /// @notice Owner-granted registry-action delegation.
    /// @dev A delegation is effective only while `grantor` remains the token owner.
    struct Delegation {
        address grantor;
        uint64 capabilities;
        uint48 validUntil;
    }

    // ---------------------------------------------------------------------
    // Storage
    // ---------------------------------------------------------------------

    address private _componentsAddress;
    uint48 private _maxDelegationDuration;

    mapping(bytes32 serialHash => ComponentRecord record) private _componentRecords;
    mapping(bytes32 serialHash => mapping(address delegate => Delegation delegation)) private _delegations;
    mapping(address account => string infoURI) private _accountInfo;

    // ---------------------------------------------------------------------
    // Errors
    // ---------------------------------------------------------------------

    error ZeroAddress();
    error EmptySerialNumber();
    error ComponentsHasNoCode(address tokenContract);
    error ComponentsUnsupported(address tokenContract);
    error ComponentAlreadyRegistered(bytes32 serialHash);
    error ComponentNotRegistered(bytes32 serialHash);
    error Unauthorized(address actor, bytes32 serialHash, uint64 requiredCapability);
    error InvalidCapabilityMask(uint64 capabilities);
    error InvalidDelegationExpiry(uint48 validUntil);
    error InvalidStatus(ComponentStatus status);
    error EmptyTokenURI();
    error EmptyLifecycleURI();
    error TimestampOutOfRange(uint256 timestamp);
    error DoesNotAcceptPayments();
    error UnknownFunction(bytes4 selector);

    // ---------------------------------------------------------------------
    // Events
    // ---------------------------------------------------------------------

    event ComponentsAddressSet(address indexed oldTokenContract, address indexed newTokenContract);
    event MaxDelegationDurationSet(uint48 oldDuration, uint48 newDuration);
    event AccountInfoSet(address indexed account, string infoURI);

    event ComponentRegistered(
        bytes32 indexed serialHash,
        address indexed tokenContract,
        uint256 indexed tokenId,
        address owner,
        address registrar,
        string serialNumber,
        string tokenURI
    );

    event ComponentMetadataUpdated(
        bytes32 indexed serialHash,
        address indexed tokenContract,
        uint256 indexed tokenId,
        address actor,
        string serialNumber,
        string tokenURI
    );

    event ComponentStatusUpdated(
        bytes32 indexed serialHash,
        address indexed tokenContract,
        uint256 indexed tokenId,
        address actor,
        string serialNumber,
        ComponentStatus oldStatus,
        ComponentStatus newStatus
    );

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

    event ComponentDelegationSet(
        bytes32 indexed serialHash,
        address indexed grantor,
        address indexed delegate,
        string serialNumber,
        uint64 capabilities,
        uint48 validUntil
    );

    // ---------------------------------------------------------------------
    // Construction
    // ---------------------------------------------------------------------

    /// @param admin Safe, timelock, governance executor, or other secured admin account.
    /// @param adminDelay Delay, in seconds, for future DEFAULT_ADMIN_ROLE transfers.
    /// @param componentsAddress_ Component-token contract for new registrations.
    constructor(address admin, uint48 adminDelay, address componentsAddress_)
        AccessControlDefaultAdminRules(adminDelay, admin)
    {
        _grantRole(PAUSER_ROLE, admin);
        _grantRole(CONFIGURER_ROLE, admin);

        _setMaxDelegationDuration(DEFAULT_MAX_DELEGATION_DURATION);
        _setComponentsAddress(componentsAddress_);
    }

    // ---------------------------------------------------------------------
    // Operations / configuration
    // ---------------------------------------------------------------------

    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(PAUSER_ROLE) {
        _unpause();
    }

    /// @notice Component-token contract used by `registerComponent`.
    function componentsAddress() external view override returns (address) {
        return _componentsAddress;
    }

    function paused() public view override(Pausable, IBicycleComponentManagerView) returns (bool) {
        return super.paused();
    }

    /// @notice Sets the component-token contract for future registrations.
    /// @dev Existing records keep their original token contract.
    function setComponentsAddress(address tokenContract) external onlyRole(CONFIGURER_ROLE) {
        _setComponentsAddress(tokenContract);
    }

    function maxDelegationDuration() external view returns (uint48) {
        return _maxDelegationDuration;
    }

    function setMaxDelegationDuration(uint48 duration) external onlyRole(CONFIGURER_ROLE) {
        _setMaxDelegationDuration(duration);
    }

    // ---------------------------------------------------------------------
    // Serial helpers
    // ---------------------------------------------------------------------

    function serialHashOf(string calldata serialNumber) public pure returns (bytes32) {
        return _requireSerialNumber(serialNumber);
    }

    /// @notice Deterministically maps a serial number to a token id.
    /// @dev Serial-number normalization should happen off-chain before calling this function.
    function tokenIdOf(string calldata serialNumber) public pure returns (uint256) {
        return uint256(serialHashOf(serialNumber));
    }

    // ---------------------------------------------------------------------
    // Registration
    // ---------------------------------------------------------------------

    /// @notice Registers a component into the configured component-token contract.
    function registerComponent(address owner, string calldata serialNumber, string calldata tokenURI_)
        external
        onlyRole(REGISTRAR_ROLE)
        whenNotPaused
        returns (address tokenContract, uint256 tokenId)
    {
        tokenContract = _componentsAddress;
        tokenId = _registerComponent(tokenContract, owner, serialNumber, tokenURI_);
    }

    // ---------------------------------------------------------------------
    // Owner / delegate registry actions
    // ---------------------------------------------------------------------

    function setComponentMetadata(string calldata serialNumber, string calldata tokenURI_) external whenNotPaused {
        bytes32 serialHash = _requireSerialNumber(serialNumber);
        ComponentRecord storage record = _requireRegistered(serialHash);
        address actor = _msgSender();

        if (!_canAct(record, actor, CAP_UPDATE_METADATA)) {
            revert Unauthorized(actor, serialHash, CAP_UPDATE_METADATA);
        }
        if (record.status == ComponentStatus.Retired) revert InvalidStatus(record.status);
        if (bytes(tokenURI_).length == 0) revert EmptyTokenURI();

        IBicycleComponents(record.tokenContract).setTokenURI(record.tokenId, tokenURI_);
        record.updatedAt = _now48();

        emit ComponentMetadataUpdated(
            serialHash, record.tokenContract, record.tokenId, actor, record.serialNumber, tokenURI_
        );
    }

    function markComponentMissing(string calldata serialNumber, string calldata reportURI) external whenNotPaused {
        _setMissing(serialNumber, true, reportURI);
    }

    function clearComponentMissing(string calldata serialNumber, string calldata resolutionURI) external whenNotPaused {
        _setMissing(serialNumber, false, resolutionURI);
    }

    function retireComponent(string calldata serialNumber) external whenNotPaused {
        bytes32 serialHash = _requireSerialNumber(serialNumber);
        ComponentRecord storage record = _requireRegistered(serialHash);
        address actor = _msgSender();

        if (!_canAct(record, actor, CAP_RETIRE)) {
            revert Unauthorized(actor, serialHash, CAP_RETIRE);
        }
        // A missing report must be resolved with a URI before the component
        // enters the final Retired state; otherwise indexers see an open report
        // with no closing event.
        if (record.status != ComponentStatus.Active) revert InvalidStatus(record.status);

        _updateStatus(record, actor, ComponentStatus.Retired);
    }

    /// @notice Grants a delegate limited, expiring permission over registry actions for a component.
    /// @dev The delegation is effective only while the grantor remains the token owner.
    function setComponentDelegate(
        string calldata serialNumber,
        address delegate,
        uint64 capabilities,
        uint48 validUntil
    ) external whenNotPaused {
        if (delegate == address(0)) revert ZeroAddress();

        bytes32 serialHash = _requireSerialNumber(serialNumber);
        ComponentRecord storage record = _requireRegistered(serialHash);
        address actor = _msgSender();
        address owner = _ownerOf(record);

        if (actor != owner) revert Unauthorized(actor, serialHash, 0);

        _validateDelegation(capabilities, validUntil);

        _delegations[serialHash][delegate] =
            Delegation({grantor: owner, capabilities: capabilities, validUntil: validUntil});

        emit ComponentDelegationSet(serialHash, owner, delegate, record.serialNumber, capabilities, validUntil);
    }

    function revokeComponentDelegate(string calldata serialNumber, address delegate) external whenNotPaused {
        if (delegate == address(0)) revert ZeroAddress();

        bytes32 serialHash = _requireSerialNumber(serialNumber);
        ComponentRecord storage record = _requireRegistered(serialHash);
        address actor = _msgSender();
        address owner = _ownerOf(record);

        if (actor != owner) revert Unauthorized(actor, serialHash, 0);

        delete _delegations[serialHash][delegate];

        emit ComponentDelegationSet(serialHash, owner, delegate, record.serialNumber, 0, 0);
    }

    // ---------------------------------------------------------------------
    // Account/profile metadata
    // ---------------------------------------------------------------------

    function accountInfo(address account) external view override returns (string memory) {
        return _accountInfo[account];
    }

    /// @notice Sets the caller's public profile/contact-info URI.
    /// @dev Store a URI or content hash, not sensitive plaintext personal data.
    /// Empty string intentionally clears optional profile metadata; component
    /// metadata and lifecycle reports have stricter non-empty guards.
    function setAccountInfo(string calldata infoURI) external whenNotPaused {
        address account = _msgSender();
        _accountInfo[account] = infoURI;
        emit AccountInfoSet(account, infoURI);
    }

    // ---------------------------------------------------------------------
    // UI-friendly reads
    // ---------------------------------------------------------------------

    function isRegistered(string calldata serialNumber) external view returns (bool) {
        return _componentRecords[serialHashOf(serialNumber)].status != ComponentStatus.None;
    }

    function componentBySerial(string calldata serialNumber)
        external
        view
        override
        returns (ComponentView memory view_)
    {
        bytes32 serialHash = serialHashOf(serialNumber);
        ComponentRecord storage record = _componentRecords[serialHash];

        view_.serialHash = serialHash;
        view_.tokenId = uint256(serialHash);

        if (record.status == ComponentStatus.None) {
            return view_;
        }

        view_.exists = true;
        view_.tokenContract = record.tokenContract;
        view_.tokenId = record.tokenId;
        view_.owner = _ownerOf(record);
        view_.registrar = record.registrar;
        view_.status = record.status;
        view_.tokenURI = _tokenURI(record);
        view_.missingReportURI = record.missingReportURI;
        view_.registeredAt = record.registeredAt;
        view_.updatedAt = record.updatedAt;
        view_.serialNumber = record.serialNumber;
    }

    function componentRecord(bytes32 serialHash)
        external
        view
        returns (
            bool exists,
            address tokenContract,
            uint256 tokenId,
            address registrar,
            ComponentStatus status,
            uint48 registeredAt,
            uint48 updatedAt,
            string memory serialNumber
        )
    {
        ComponentRecord storage record = _componentRecords[serialHash];
        exists = record.status != ComponentStatus.None;
        return (
            exists,
            record.tokenContract,
            record.tokenId,
            record.registrar,
            record.status,
            record.registeredAt,
            record.updatedAt,
            record.serialNumber
        );
    }

    function tokenReference(string calldata serialNumber)
        external
        view
        returns (address tokenContract, uint256 tokenId)
    {
        ComponentRecord storage record = _componentRecords[serialHashOf(serialNumber)];

        if (record.status == ComponentStatus.None) {
            // Intentional default: unregistered components are represented as
            // address(0) plus a deterministic token id. This is convenient for
            // lookup UIs, but callers must not treat it as an existing token.
            return (address(0), uint256(serialHashOf(serialNumber)));
        }

        return (record.tokenContract, record.tokenId);
    }

    function ownerOf(string calldata serialNumber) public view returns (address) {
        ComponentRecord storage record = _componentRecords[serialHashOf(serialNumber)];
        // Intentional default: this intentionally returns address(0) instead
        // of reverting for unknown serials. Keep callers aware that zero means
        // "no recorded owner", not an account.
        if (record.status == ComponentStatus.None) return address(0);
        return _ownerOf(record);
    }

    function componentURI(string calldata serialNumber) public view returns (string memory) {
        ComponentRecord storage record = _componentRecords[serialHashOf(serialNumber)];
        // Intentional default: the empty string is the unknown-component
        // sentinel. It should not be confused with a deliberately blank URI.
        if (record.status == ComponentStatus.None) return "";
        return _tokenURI(record);
    }

    function componentStatus(string calldata serialNumber) public view returns (ComponentStatus) {
        return _componentRecords[serialHashOf(serialNumber)].status;
    }

    function missingStatus(string calldata serialNumber) external view returns (bool) {
        return componentStatus(serialNumber) == ComponentStatus.Missing;
    }

    function componentDelegation(string calldata serialNumber, address delegate)
        external
        view
        returns (address grantor, uint64 capabilities, uint48 validUntil, bool active)
    {
        bytes32 serialHash = serialHashOf(serialNumber);
        ComponentRecord storage record = _componentRecords[serialHash];
        Delegation storage delegation = _delegations[serialHash][delegate];

        grantor = delegation.grantor;
        capabilities = delegation.capabilities;
        validUntil = delegation.validUntil;
        active = record.status != ComponentStatus.None && _effectiveDelegationCapabilities(record, delegate) != 0;
    }

    function permissionsOf(address actor, string calldata serialNumber)
        public
        view
        override
        returns (uint64 capabilities)
    {
        ComponentRecord storage record = _componentRecords[serialHashOf(serialNumber)];
        if (record.status == ComponentStatus.None || actor == address(0)) return 0;

        if (_isTokenOwner(record, actor)) {
            return VALID_CAPABILITY_MASK;
        }

        return _effectiveDelegationCapabilities(record, actor);
    }

    function canRegister(address actor) external view override returns (bool) {
        return actor != address(0) && hasRole(REGISTRAR_ROLE, actor);
    }

    function canUpdateMetadata(address actor, string calldata serialNumber) external view override returns (bool) {
        ComponentRecord storage record = _componentRecords[serialHashOf(serialNumber)];
        return record.status != ComponentStatus.None && record.status != ComponentStatus.Retired
            && _canAct(record, actor, CAP_UPDATE_METADATA);
    }

    function canMarkMissing(address actor, string calldata serialNumber) external view override returns (bool) {
        ComponentRecord storage record = _componentRecords[serialHashOf(serialNumber)];
        return record.status == ComponentStatus.Active && _canAct(record, actor, CAP_MARK_MISSING);
    }

    function canClearMissing(address actor, string calldata serialNumber) external view override returns (bool) {
        ComponentRecord storage record = _componentRecords[serialHashOf(serialNumber)];
        return record.status == ComponentStatus.Missing && _canAct(record, actor, CAP_CLEAR_MISSING);
    }

    function canRetire(address actor, string calldata serialNumber) external view override returns (bool) {
        ComponentRecord storage record = _componentRecords[serialHashOf(serialNumber)];
        return record.status == ComponentStatus.Active && _canAct(record, actor, CAP_RETIRE);
    }

    // ---------------------------------------------------------------------
    // Internal registration / status helpers
    // ---------------------------------------------------------------------

    function _registerComponent(
        address tokenContract,
        address owner,
        string calldata serialNumber,
        string calldata tokenURI_
    ) internal returns (uint256 tokenId) {
        if (owner == address(0)) revert ZeroAddress();

        bytes32 serialHash = _requireSerialNumber(serialNumber);
        if (_componentRecords[serialHash].status != ComponentStatus.None) {
            revert ComponentAlreadyRegistered(serialHash);
        }
        if (bytes(tokenURI_).length == 0) revert EmptyTokenURI();

        tokenId = uint256(serialHash);

        IBicycleComponents(tokenContract).safeMint(owner, tokenId, tokenURI_, "");

        uint48 now_ = _now48();
        _componentRecords[serialHash] = ComponentRecord({
            serialHash: serialHash,
            tokenContract: tokenContract,
            tokenId: tokenId,
            registrar: _msgSender(),
            status: ComponentStatus.Active,
            missingReportURI: "",
            registeredAt: now_,
            updatedAt: now_,
            serialNumber: serialNumber
        });

        emit ComponentRegistered(serialHash, tokenContract, tokenId, owner, _msgSender(), serialNumber, tokenURI_);
    }

    function _setMissing(string calldata serialNumber, bool isMissing, string calldata lifecycleURI) internal {
        bytes32 serialHash = _requireSerialNumber(serialNumber);
        ComponentRecord storage record = _requireRegistered(serialHash);
        address actor = _msgSender();

        if (isMissing) {
            if (!_canAct(record, actor, CAP_MARK_MISSING)) {
                revert Unauthorized(actor, serialHash, CAP_MARK_MISSING);
            }
            if (record.status != ComponentStatus.Active) revert InvalidStatus(record.status);
            if (bytes(lifecycleURI).length == 0) revert EmptyLifecycleURI();
            record.missingReportURI = lifecycleURI;
            _updateStatus(record, actor, ComponentStatus.Missing);
            emit ComponentReported(record.serialHash, record.tokenContract, actor, record.tokenId, record.serialNumber, lifecycleURI);
        } else {
            if (!_canAct(record, actor, CAP_CLEAR_MISSING)) {
                revert Unauthorized(actor, serialHash, CAP_CLEAR_MISSING);
            }
            if (record.status != ComponentStatus.Missing) revert InvalidStatus(record.status);
            if (bytes(lifecycleURI).length == 0) revert EmptyLifecycleURI();
            delete record.missingReportURI;
            _updateStatus(record, actor, ComponentStatus.Active);
            emit ComponentReportResolved(
                record.serialHash, record.tokenContract, actor, record.tokenId, record.serialNumber, lifecycleURI
            );
        }
    }

    function _updateStatus(ComponentRecord storage record, address actor, ComponentStatus newStatus) internal {
        ComponentStatus oldStatus = record.status;
        record.status = newStatus;
        record.updatedAt = _now48();

        emit ComponentStatusUpdated(
            record.serialHash, record.tokenContract, record.tokenId, actor, record.serialNumber, oldStatus, newStatus
        );
    }

    // ---------------------------------------------------------------------
    // Internal authorization helpers
    // ---------------------------------------------------------------------

    function _isTokenOwner(ComponentRecord storage record, address actor) internal view returns (bool) {
        return actor != address(0) && _ownerOf(record) == actor;
    }

    function _hasCapability(ComponentRecord storage record, address actor, uint64 capability)
        internal
        view
        returns (bool)
    {
        if (actor == address(0)) return false;
        return (_effectiveDelegationCapabilities(record, actor) & capability) != 0;
    }

    function _canAct(ComponentRecord storage record, address actor, uint64 capability) internal view returns (bool) {
        return _isTokenOwner(record, actor) || _hasCapability(record, actor, capability);
    }

    function _effectiveDelegationCapabilities(ComponentRecord storage record, address actor)
        internal
        view
        returns (uint64)
    {
        Delegation storage delegation = _delegations[record.serialHash][actor];

        // Intentional default: all inactive delegation cases collapse to
        // capability mask 0. That keeps callers simple, but hides which
        // precondition failed unless a dedicated diagnostic view is added.
        if (delegation.grantor == address(0)) return 0;
        if (delegation.capabilities == 0) return 0;
        if (block.timestamp > type(uint48).max) revert TimestampOutOfRange(block.timestamp);
        if (delegation.validUntil <= block.timestamp) return 0;
        if (_ownerOf(record) != delegation.grantor) return 0;

        return delegation.capabilities;
    }

    function _validateDelegation(uint64 capabilities, uint48 validUntil) internal view {
        if (capabilities == 0 || (capabilities & ~VALID_CAPABILITY_MASK) != 0) {
            revert InvalidCapabilityMask(capabilities);
        }

        uint48 now_ = _now48();
        if (validUntil <= now_) {
            revert InvalidDelegationExpiry(validUntil);
        }
        if (validUntil - now_ > _maxDelegationDuration) {
            revert InvalidDelegationExpiry(validUntil);
        }
    }

    // ---------------------------------------------------------------------
    // Internal configuration/read helpers
    // ---------------------------------------------------------------------

    function _setComponentsAddress(address tokenContract) internal {
        if (tokenContract == address(0)) revert ZeroAddress();
        _requireSupportedComponents(tokenContract);

        address oldTokenContract = _componentsAddress;
        _componentsAddress = tokenContract;
        emit ComponentsAddressSet(oldTokenContract, tokenContract);
    }

    function _setMaxDelegationDuration(uint48 duration) internal {
        if (duration == 0) revert InvalidDelegationExpiry(duration);

        uint48 oldDuration = _maxDelegationDuration;
        _maxDelegationDuration = duration;
        emit MaxDelegationDurationSet(oldDuration, duration);
    }

    function _requireSupportedComponents(address tokenContract) internal view {
        if (tokenContract.code.length == 0) revert ComponentsHasNoCode(tokenContract);

        try IERC165(tokenContract).supportsInterface(type(IBicycleComponents).interfaceId) returns (bool supported) {
            if (!supported) revert ComponentsUnsupported(tokenContract);
        } catch {
            revert ComponentsUnsupported(tokenContract);
        }
    }

    function _requireSerialNumber(string calldata serialNumber) internal pure returns (bytes32 serialHash) {
        if (bytes(serialNumber).length == 0) revert EmptySerialNumber();
        serialHash = keccak256(bytes(serialNumber));
    }

    function _requireRegistered(bytes32 serialHash) internal view returns (ComponentRecord storage record) {
        record = _componentRecords[serialHash];
        if (record.status == ComponentStatus.None) revert ComponentNotRegistered(serialHash);
    }

    function _ownerOf(ComponentRecord storage record) internal view returns (address) {
        return IBicycleComponents(record.tokenContract).ownerOf(record.tokenId);
    }

    function _tokenURI(ComponentRecord storage record) internal view returns (string memory) {
        return IBicycleComponents(record.tokenContract).tokenURI(record.tokenId);
    }

    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(AccessControlDefaultAdminRules, IERC165)
        returns (bool)
    {
        return interfaceId == type(IBicycleComponentManagerView).interfaceId || super.supportsInterface(interfaceId);
    }

    function _now48() internal view returns (uint48) {
        if (block.timestamp > type(uint48).max) revert TimestampOutOfRange(block.timestamp);
        return uint48(block.timestamp);
    }

    receive() external payable {
        revert DoesNotAcceptPayments();
    }

    fallback() external payable {
        revert UnknownFunction(msg.sig);
    }
}
