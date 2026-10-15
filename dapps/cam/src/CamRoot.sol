pragma solidity 0.8.35;

import {Ownable} from "@openzeppelin-contracts-5.6.1/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin-contracts-5.6.1/access/Ownable2Step.sol";
import {IERC165} from "@openzeppelin-contracts-5.6.1/utils/introspection/IERC165.sol";

import "./ICamApp.sol";

/// @notice Minimal CAM root for one app deployment on one chain.
///
/// This contract serves its own CAM and resolves contract names used by the
/// CAM to deployed addresses on this chain.
///
/// Example:
///
///     contractAddress("BicycleComponentManager")
///     contractAddress("BicycleComponents")
///
/// Passing `address(0)` to `setContractAddress` clears a binding.
contract CamRoot is ICamApp, Ownable2Step {
    ManifestRef private _manifest;

    /// @notice Resolves a CAM contract name to this chain's deployed address.
    mapping(bytes32 contractNameHash => address deployedAt) private _contractAddress;

    event CamUpdated(string uri, bytes32 sha256Digest);
    event ContractAddressSet(bytes32 indexed contractNameHash, string contractName, address indexed deployedAt);

    error EmptyCamURI();
    error EmptyContractName();

    constructor(address admin, string memory uri, bytes32 sha256Digest) Ownable(admin) {
        _setCam(uri, sha256Digest);
    }

    /// @inheritdoc IERC165
    function supportsInterface(bytes4 interfaceId) external pure override returns (bool) {
        return interfaceId == type(ICamApp).interfaceId || interfaceId == type(IERC165).interfaceId;
    }

    /// @inheritdoc ICamApp
    function camManifest() external view override returns (ManifestRef memory) {
        return _manifest;
    }

    /// @notice Updates the URI and SHA-256 digest of the exact CAM bytes together.
    function setCam(string calldata uri, bytes32 sha256Digest) external onlyOwner {
        _setCam(uri, sha256Digest);
    }

    /// @notice Resolves a CAM contract name to this chain's deployed address.
    function contractAddress(string calldata contractName) external view override returns (address) {
        // Intentional default: Solidity mappings return address(0) for an
        // unset binding. CAM clients currently must treat address(0) as
        // unbound; consider an explicit exists flag if this becomes ambiguous.
        return _contractAddress[keccak256(bytes(contractName))];
    }

    /// @notice Resolves a precomputed CAM contract-name hash.
    function contractAddressByHash(bytes32 contractNameHash) external view returns (address) {
        // Intentional default: this has the same unset-binding address(0)
        // sentinel as contractAddress(string).
        return _contractAddress[contractNameHash];
    }

    /// @notice Sets, updates, or clears the address for a CAM contract name.
    function setContractAddress(string calldata contractName, address deployedAt) external onlyOwner {
        if (bytes(contractName).length == 0) revert EmptyContractName();

        bytes32 contractNameHash = keccak256(bytes(contractName));
        _contractAddress[contractNameHash] = deployedAt;

        emit ContractAddressSet(contractNameHash, contractName, deployedAt);
    }

    function _setCam(string memory uri, bytes32 sha256Digest) private {
        if (bytes(uri).length == 0) revert EmptyCamURI();

        _manifest = ManifestRef(uri, sha256Digest);

        emit CamUpdated(uri, sha256Digest);
    }
}
