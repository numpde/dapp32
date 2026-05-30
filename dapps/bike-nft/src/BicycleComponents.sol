pragma solidity 0.8.35;

import {
    AccessControlDefaultAdminRules
} from "@openzeppelin-contracts-5.6.1/access/extensions/AccessControlDefaultAdminRules.sol";
import {ERC721} from "@openzeppelin-contracts-5.6.1/token/ERC721/ERC721.sol";
import {ERC721Pausable} from "@openzeppelin-contracts-5.6.1/token/ERC721/extensions/ERC721Pausable.sol";
import {ERC721URIStorage} from "@openzeppelin-contracts-5.6.1/token/ERC721/extensions/ERC721URIStorage.sol";
import {IERC721Metadata} from "@openzeppelin-contracts-5.6.1/token/ERC721/extensions/IERC721Metadata.sol";
import {IERC165} from "@openzeppelin-contracts-5.6.1/utils/introspection/IERC165.sol";

import {IBicycleComponents} from "./IBicycleComponents.sol";

/// @title BicycleComponents
/// @notice ERC-721 collection for registered bicycle components.
/// @dev
/// V1 keeps this contract deliberately close to a normal ERC-721 collection:
///
/// - owners can use standard ERC-721 approvals and transfers;
/// - wallets, explorers, marketplaces, and indexers can treat tokens normally;
/// - minting and token URI updates are exposed through a small role-gated API;
/// - serial-number lookup, missing status, registrar rules, delegations, and
///   recovery/dispute state belong in BicycleComponentManager.
///
/// The contract is intentionally not upgradeable. If token behavior needs to
/// change later, deploy a new component-token contract and update the manager's
/// configured component contract for future registrations.
contract BicycleComponents is
    ERC721,
    ERC721URIStorage,
    ERC721Pausable,
    AccessControlDefaultAdminRules,
    IBicycleComponents
{
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");
    bytes32 public constant CONFIGURER_ROLE = keccak256("CONFIGURER_ROLE");
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    bytes32 public constant TOKEN_URI_SETTER_ROLE = keccak256("TOKEN_URI_SETTER_ROLE");

    string private _baseTokenURI;
    string private _contractMetadataURI;

    event BaseURIUpdated(string oldBaseURI, string newBaseURI);
    event ContractURIUpdated(string oldContractURI, string newContractURI);

    /// @param tokenName ERC-721 collection name.
    /// @param tokenSymbol ERC-721 collection symbol.
    /// @param admin Safe, timelock, governance executor, or other secured admin account.
    /// @param adminDelay Delay, in seconds, for future DEFAULT_ADMIN_ROLE transfers.
    /// @param baseTokenURI Optional base URI prefix used with stored token URI suffixes.
    /// @param collectionURI Optional collection-level metadata URI.
    constructor(
        string memory tokenName,
        string memory tokenSymbol,
        address admin,
        uint48 adminDelay,
        string memory baseTokenURI,
        string memory collectionURI
    ) ERC721(tokenName, tokenSymbol) AccessControlDefaultAdminRules(adminDelay, admin) {
        _grantRole(PAUSER_ROLE, admin);
        _grantRole(CONFIGURER_ROLE, admin);
        _grantRole(MINTER_ROLE, admin);
        _grantRole(TOKEN_URI_SETTER_ROLE, admin);

        _setBaseURI(baseTokenURI);
        _setContractURI(collectionURI);
    }

    // -------------------------------------------------------------------------
    // Operations
    // -------------------------------------------------------------------------

    /// @notice Pauses token transfers, minting, and metadata updates.
    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }

    /// @notice Resumes token transfers, minting, and metadata updates.
    function unpause() external onlyRole(PAUSER_ROLE) {
        _unpause();
    }

    /// @inheritdoc IBicycleComponents
    function baseURI() external view returns (string memory) {
        return _baseTokenURI;
    }

    /// @notice Updates the base URI prefix used by tokenURI.
    function setBaseURI(string calldata baseTokenURI) external onlyRole(CONFIGURER_ROLE) {
        _setBaseURI(baseTokenURI);
    }

    /// @inheritdoc IBicycleComponents
    /// @dev This is collection metadata, not the CAM URI.
    function contractURI() external view returns (string memory) {
        return _contractMetadataURI;
    }

    /// @notice Updates collection-level metadata URI.
    function setContractURI(string calldata collectionURI) external onlyRole(CONFIGURER_ROLE) {
        _setContractURI(collectionURI);
    }

    // -------------------------------------------------------------------------
    // Privileged minting / metadata
    // -------------------------------------------------------------------------

    /// @inheritdoc IBicycleComponents
    /// @dev Restricted to accounts/contracts with MINTER_ROLE.
    function mint(address to, uint256 tokenId, string calldata uri) external onlyRole(MINTER_ROLE) whenNotPaused {
        _mint(to, tokenId);
        _setTokenURI(tokenId, uri);
    }

    /// @inheritdoc IBicycleComponents
    /// @dev Restricted to accounts/contracts with MINTER_ROLE.
    function safeMint(address to, uint256 tokenId, string calldata uri, bytes calldata data)
        external
        onlyRole(MINTER_ROLE)
        whenNotPaused
    {
        _safeMint(to, tokenId, data);
        _setTokenURI(tokenId, uri);
    }

    /// @inheritdoc IBicycleComponents
    /// @dev Restricted to accounts/contracts with TOKEN_URI_SETTER_ROLE.
    function setTokenURI(uint256 tokenId, string calldata uri) external onlyRole(TOKEN_URI_SETTER_ROLE) whenNotPaused {
        _requireOwned(tokenId);
        _setTokenURI(tokenId, uri);
    }

    /// @inheritdoc IBicycleComponents
    function exists(uint256 tokenId) external view returns (bool) {
        return _ownerOf(tokenId) != address(0);
    }

    // -------------------------------------------------------------------------
    // Internal helpers and OpenZeppelin overrides
    // -------------------------------------------------------------------------

    function _setBaseURI(string memory baseTokenURI) internal {
        string memory oldBaseURI = _baseTokenURI;
        _baseTokenURI = baseTokenURI;

        emit BaseURIUpdated(oldBaseURI, baseTokenURI);
    }

    function _setContractURI(string memory collectionURI) internal {
        string memory oldContractURI = _contractMetadataURI;
        _contractMetadataURI = collectionURI;

        emit ContractURIUpdated(oldContractURI, collectionURI);
    }

    function _baseURI() internal view override returns (string memory) {
        return _baseTokenURI;
    }

    function _update(address to, uint256 tokenId, address auth)
        internal
        override(ERC721, ERC721Pausable)
        returns (address)
    {
        return super._update(to, tokenId, auth);
    }

    function tokenURI(uint256 tokenId)
        public
        view
        override(ERC721, ERC721URIStorage, IERC721Metadata)
        returns (string memory)
    {
        return super.tokenURI(tokenId);
    }

    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(ERC721, ERC721URIStorage, AccessControlDefaultAdminRules, IERC165)
        returns (bool)
    {
        return interfaceId == type(IBicycleComponents).interfaceId || super.supportsInterface(interfaceId);
    }
}
