pragma solidity 0.8.35;

import {IERC165} from "@openzeppelin-contracts-5.6.1/utils/introspection/IERC165.sol";

/// @notice Minimal read interface for a CAM-capable contract.
///
/// A CAM client can start from `chainId + contractAddress`, check ERC-165,
/// then call `camManifest()` to load and verify the exact document bytes.
interface ICamApp is IERC165 {
    struct ManifestRef {
        string uri;
        bytes32 sha256Digest;
    }

    function camManifest() external view returns (ManifestRef memory);

    /// @notice Resolves a manifest contract name; address(0) means unbound.
    function contractAddress(string calldata contractName) external view returns (address);
}
