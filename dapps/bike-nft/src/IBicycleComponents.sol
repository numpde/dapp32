pragma solidity 0.8.35;

import {IERC721Metadata} from "@openzeppelin-contracts-5.6.1/token/ERC721/extensions/IERC721Metadata.sol";

/// @notice Minimal interface for a bicycle component NFT collection.
///
/// The standard ERC-721 surface comes from IERC721Metadata. The extra methods
/// are the small privileged surface a registry/manager contract needs in order
/// to create verified component tokens and update their metadata.
interface IBicycleComponents is IERC721Metadata {
    /// @notice Mints `tokenId` to `to` and assigns its metadata URI.
    /// @dev May mint to contracts that do not implement IERC721Receiver.
    function mint(address to, uint256 tokenId, string calldata uri) external;

    /// @notice Safely mints `tokenId` to `to` and assigns its metadata URI.
    /// @dev Performs the ERC-721 receiver check when `to` is a contract.
    function safeMint(address to, uint256 tokenId, string calldata uri, bytes calldata data) external;

    /// @notice Updates the metadata URI for an existing token.
    function setTokenURI(uint256 tokenId, string calldata uri) external;

    /// @notice Returns true if `tokenId` exists.
    function exists(uint256 tokenId) external view returns (bool);

    /// @notice Returns the base URI prefix used by tokenURI.
    function baseURI() external view returns (string memory);

    /// @notice Returns collection-level metadata URI.
    function contractURI() external view returns (string memory);
}
