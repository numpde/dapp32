pragma solidity 0.8.35;

import {IERC165} from "@openzeppelin-contracts-5.6.1/utils/introspection/IERC165.sol";

/// @notice Minimal read interface for a CAM-capable contract.
///
/// A CAM client can start from `chainId + contractAddress`, check ERC-165,
/// then call `camURI()` and `camHash()` to load and verify the CAM document.
interface ICamApp is IERC165 {
    function camURI() external view returns (string memory);

    function camHash() external view returns (bytes32);
}
