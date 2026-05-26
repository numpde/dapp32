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
/// - account profile URIs and event-only attestations.
///
/// The manager can use different component-token contracts over time. Each
/// registered component stores its own `tokenContract`, so changing the default
/// collection only affects future registrations.
contract BicycleComponentManager is AccessControlDefaultAdminRules, Pausable, IBicycleComponentManagerView {
    // ---------------------------------------------------------------------
    // Roles
    // ---------------------------------------------------------------------

    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");
    bytes32 public constant CONFIGURER_ROLE = keccak256("CONFIGURER_ROLE");
    bytes32 public constant REGISTRAR_ROLE = keccak256("REGISTRAR_ROLE");
    bytes32 public constant STATUS_ATTESTER_ROLE = keccak256("STATUS_ATTESTER_ROLE");

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

    address private _defaultComponents;
    uint48 private _maxDelegationDuration;

    mapping(address tokenContract => bool allowed) private _componentCollections;
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
    error ComponentsNotAllowed(address tokenContract);
    error DefaultComponentsUnset();
    error ComponentAlreadyRegistered(bytes32 serialHash);
    error ComponentNotRegistered(bytes32 serialHash);
    error Unauthorized(address actor, bytes32 serialHash, uint64 requiredCapability);
    error InvalidCapabilityMask(uint64 capabilities);
    error InvalidDelegationExpiry(uint48 validUntil);
    error InvalidStatus(ComponentStatus status);
    error DoesNotAcceptPayments();
    error UnknownFunction(bytes4 selector);

    // ---------------------------------------------------------------------
    // Events
    // ---------------------------------------------------------------------

    event ComponentCollectionSet(address indexed tokenContract, bool allowed);
    event DefaultComponentsSet(address indexed oldTokenContract, address indexed newTokenContract);
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

    event ComponentDelegationSet(
        bytes32 indexed serialHash,
        address indexed grantor,
        address indexed delegate,
        string serialNumber,
        uint64 capabilities,
        uint48 validUntil
    );

    event ComponentAttestationAdded(
        bytes32 indexed serialHash,
        bytes32 indexed attestationType,
        address indexed attester,
        address tokenContract,
        uint256 tokenId,
        string serialNumber,
        string attestationURI
    );

    // ---------------------------------------------------------------------
    // Construction
    // ---------------------------------------------------------------------

    /// @param admin Safe, timelock, governance executor, or other secured admin account.
    /// @param adminDelay Delay, in seconds, for future DEFAULT_ADMIN_ROLE transfers.
    /// @param defaultComponents_ Optional default component-token contract for new registrations.
    constructor(address admin, uint48 adminDelay, address defaultComponents_)
        AccessControlDefaultAdminRules(adminDelay, admin)
    {
        _grantRole(PAUSER_ROLE, admin);
        _grantRole(CONFIGURER_ROLE, admin);
        _grantRole(REGISTRAR_ROLE, admin);
        _grantRole(STATUS_ATTESTER_ROLE, admin);

        _setMaxDelegationDuration(DEFAULT_MAX_DELEGATION_DURATION);

        if (defaultComponents_ != address(0)) {
            _setComponentCollection(defaultComponents_, true);
            _setDefaultComponents(defaultComponents_);
        }
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

    /// @notice Default component-token contract used by `registerComponent`.
    function defaultComponents() external view override returns (address) {
        return _defaultComponents;
    }

    /// @notice Returns whether a component-token contract is approved for registrations.
    function isComponentCollection(address tokenContract) external view returns (bool) {
        return _componentCollections[tokenContract];
    }

    /// @notice Allows or disallows a component-token contract for future registrations.
    /// @dev Disallowing the current default clears the default. Existing records are unchanged.
    function setComponentCollection(address tokenContract, bool allowed) external onlyRole(CONFIGURER_ROLE) {
        _setComponentCollection(tokenContract, allowed);

        if (!allowed && _defaultComponents == tokenContract) {
            _setDefaultComponents(address(0));
        }
    }

    /// @notice Sets the default component-token contract for future registrations.
    /// @dev Passing address(0) clears the default.
    function setDefaultComponents(address tokenContract) external onlyRole(CONFIGURER_ROLE) {
        if (tokenContract != address(0) && !_componentCollections[tokenContract]) {
            _setComponentCollection(tokenContract, true);
        }

        _setDefaultComponents(tokenContract);
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
        return keccak256(bytes(serialNumber));
    }

    /// @notice Deterministically maps a serial number to a token id.
    /// @dev Serial-number normalization should happen off-chain before calling this function.
    function tokenIdOf(string calldata serialNumber) public pure returns (uint256) {
        return uint256(serialHashOf(serialNumber));
    }

    // ---------------------------------------------------------------------
    // Registration
    // ---------------------------------------------------------------------

    /// @notice Registers a component into the default component-token collection.
    function registerComponent(address owner, string calldata serialNumber, string calldata tokenURI_)
        external
        onlyRole(REGISTRAR_ROLE)
        whenNotPaused
        returns (address tokenContract, uint256 tokenId)
    {
        tokenContract = _defaultComponents;
        if (tokenContract == address(0)) revert DefaultComponentsUnset();

        tokenId = _registerComponent(tokenContract, owner, serialNumber, tokenURI_);
    }

    /// @notice Registers a component into a specific approved component-token collection.
    function registerComponentIn(
        address tokenContract,
        address owner,
        string calldata serialNumber,
        string calldata tokenURI_
    ) external onlyRole(REGISTRAR_ROLE) whenNotPaused returns (uint256 tokenId) {
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

        IBicycleComponents(record.tokenContract).setTokenURI(record.tokenId, tokenURI_);
        record.updatedAt = _now48();

        emit ComponentMetadataUpdated(
            serialHash, record.tokenContract, record.tokenId, actor, record.serialNumber, tokenURI_
        );
    }

    function markMissing(string calldata serialNumber) external whenNotPaused {
        _setMissing(serialNumber, true);
    }

    function clearMissing(string calldata serialNumber) external whenNotPaused {
        _setMissing(serialNumber, false);
    }

    function setMissingStatus(string calldata serialNumber, bool isMissing) external whenNotPaused {
        _setMissing(serialNumber, isMissing);
    }

    function retireComponent(string calldata serialNumber) external whenNotPaused {
        bytes32 serialHash = _requireSerialNumber(serialNumber);
        ComponentRecord storage record = _requireRegistered(serialHash);
        address actor = _msgSender();

        if (!_canAct(record, actor, CAP_RETIRE)) {
            revert Unauthorized(actor, serialHash, CAP_RETIRE);
        }
        if (record.status == ComponentStatus.Retired) revert InvalidStatus(record.status);

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
        address owner = _ownerOfOrZero(record);

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
        address owner = _ownerOfOrZero(record);

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
    function setAccountInfo(string calldata infoURI) external whenNotPaused {
        address account = _msgSender();
        _accountInfo[account] = infoURI;
        emit AccountInfoSet(account, infoURI);
    }

    // ---------------------------------------------------------------------
    // Attestations
    // ---------------------------------------------------------------------

    /// @notice Emits an attestation for a registered component without changing ownership or status.
    /// @dev The original registrar or STATUS_ATTESTER_ROLE can add official notes/evidence URIs.
    function addComponentAttestation(
        string calldata serialNumber,
        bytes32 attestationType,
        string calldata attestationURI
    ) external whenNotPaused {
        bytes32 serialHash = _requireSerialNumber(serialNumber);
        ComponentRecord storage record = _requireRegistered(serialHash);
        address actor = _msgSender();

        if (actor != record.registrar && !hasRole(STATUS_ATTESTER_ROLE, actor)) {
            revert Unauthorized(actor, serialHash, 0);
        }

        emit ComponentAttestationAdded(
            serialHash,
            attestationType,
            actor,
            record.tokenContract,
            record.tokenId,
            record.serialNumber,
            attestationURI
        );
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
        view_.owner = _ownerOfOrZero(record);
        view_.registrar = record.registrar;
        view_.status = record.status;
        view_.tokenURI = _tokenURIOrEmpty(record);
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
            // TODO(silent-defaults): unregistered components are represented as
            // address(0) plus a deterministic token id. This is convenient for
            // lookup UIs, but callers must not treat it as an existing token.
            return (address(0), uint256(serialHashOf(serialNumber)));
        }

        return (record.tokenContract, record.tokenId);
    }

    function ownerOf(string calldata serialNumber) public view returns (address) {
        ComponentRecord storage record = _componentRecords[serialHashOf(serialNumber)];
        // TODO(silent-defaults): this intentionally returns address(0) instead
        // of reverting for unknown serials. Keep callers aware that zero means
        // "no recorded owner", not an account.
        if (record.status == ComponentStatus.None) return address(0);
        return _ownerOfOrZero(record);
    }

    function componentURI(string calldata serialNumber) public view returns (string memory) {
        ComponentRecord storage record = _componentRecords[serialHashOf(serialNumber)];
        // TODO(silent-defaults): the empty string is the unknown-component
        // sentinel. It should not be confused with a deliberately blank URI.
        if (record.status == ComponentStatus.None) return "";
        return _tokenURIOrEmpty(record);
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
        return record.status != ComponentStatus.None && record.status != ComponentStatus.Retired
            && _canAct(record, actor, CAP_RETIRE);
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
        if (!_componentCollections[tokenContract]) revert ComponentsNotAllowed(tokenContract);

        bytes32 serialHash = _requireSerialNumber(serialNumber);
        if (_componentRecords[serialHash].status != ComponentStatus.None) {
            revert ComponentAlreadyRegistered(serialHash);
        }

        tokenId = uint256(serialHash);

        IBicycleComponents(tokenContract).mint(owner, tokenId, tokenURI_);

        uint48 now_ = _now48();
        _componentRecords[serialHash] = ComponentRecord({
            serialHash: serialHash,
            tokenContract: tokenContract,
            tokenId: tokenId,
            registrar: _msgSender(),
            status: ComponentStatus.Active,
            registeredAt: now_,
            updatedAt: now_,
            serialNumber: serialNumber
        });

        emit ComponentRegistered(serialHash, tokenContract, tokenId, owner, _msgSender(), serialNumber, tokenURI_);
    }

    function _setMissing(string calldata serialNumber, bool isMissing) internal {
        bytes32 serialHash = _requireSerialNumber(serialNumber);
        ComponentRecord storage record = _requireRegistered(serialHash);
        address actor = _msgSender();

        if (isMissing) {
            if (!_canAct(record, actor, CAP_MARK_MISSING)) {
                revert Unauthorized(actor, serialHash, CAP_MARK_MISSING);
            }
            if (record.status != ComponentStatus.Active) revert InvalidStatus(record.status);
            _updateStatus(record, actor, ComponentStatus.Missing);
        } else {
            if (!_canAct(record, actor, CAP_CLEAR_MISSING)) {
                revert Unauthorized(actor, serialHash, CAP_CLEAR_MISSING);
            }
            if (record.status != ComponentStatus.Missing) revert InvalidStatus(record.status);
            _updateStatus(record, actor, ComponentStatus.Active);
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
        return actor != address(0) && _ownerOfOrZero(record) == actor;
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

        // TODO(silent-defaults): all inactive delegation cases collapse to
        // capability mask 0. That keeps callers simple, but hides which
        // precondition failed unless a dedicated diagnostic view is added.
        if (delegation.grantor == address(0)) return 0;
        if (delegation.capabilities == 0) return 0;
        if (delegation.validUntil <= block.timestamp) return 0;
        if (_ownerOfOrZero(record) != delegation.grantor) return 0;

        return delegation.capabilities;
    }

    function _validateDelegation(uint64 capabilities, uint48 validUntil) internal view {
        if (capabilities == 0 || (capabilities & ~VALID_CAPABILITY_MASK) != 0) {
            revert InvalidCapabilityMask(capabilities);
        }

        uint48 now_ = _now48();
        uint48 maxValidUntil = now_ + _maxDelegationDuration;

        if (validUntil <= now_ || validUntil > maxValidUntil) {
            revert InvalidDelegationExpiry(validUntil);
        }
    }

    // ---------------------------------------------------------------------
    // Internal configuration/read helpers
    // ---------------------------------------------------------------------

    function _setComponentCollection(address tokenContract, bool allowed) internal {
        if (tokenContract == address(0)) revert ZeroAddress();

        if (allowed) {
            _requireSupportedComponents(tokenContract);
        }

        _componentCollections[tokenContract] = allowed;
        emit ComponentCollectionSet(tokenContract, allowed);
    }

    function _setDefaultComponents(address tokenContract) internal {
        address oldTokenContract = _defaultComponents;
        _defaultComponents = tokenContract;
        emit DefaultComponentsSet(oldTokenContract, tokenContract);
    }

    function _setMaxDelegationDuration(uint48 duration) internal {
        if (duration == 0) revert InvalidDelegationExpiry(0);

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

    function _ownerOfOrZero(ComponentRecord storage record) internal view returns (address) {
        try IBicycleComponents(record.tokenContract).ownerOf(record.tokenId) returns (address owner) {
            return owner;
        } catch {
            // TODO(silent-defaults): owner lookup failures collapse to
            // address(0). This protects read helpers from reverting, but can
            // hide a broken component-token contract.
            return address(0);
        }
    }

    function _tokenURIOrEmpty(ComponentRecord storage record) internal view returns (string memory) {
        try IBicycleComponents(record.tokenContract).tokenURI(record.tokenId) returns (string memory uri) {
            return uri;
        } catch {
            // TODO(silent-defaults): tokenURI lookup failures collapse to "".
            // Callers cannot distinguish missing metadata from a token contract
            // error without an explicit diagnostic path.
            return "";
        }
    }

    function _now48() internal view returns (uint48) {
        return uint48(block.timestamp);
    }

    receive() external payable {
        revert DoesNotAcceptPayments();
    }

    fallback() external payable {
        revert UnknownFunction(msg.sig);
    }
}
