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
    /// @inheritdoc ICamApp
    string public override camURI;

    /// @inheritdoc ICamApp
    bytes32 public override camHash;

    /// @notice Resolves a CAM contract name to this chain's deployed address.
    mapping(bytes32 contractNameHash => address deployedAt) private _contractAddress;

    event CamUpdated(string camURI, bytes32 camHash);
    event ContractAddressSet(bytes32 indexed contractNameHash, string contractName, address indexed deployedAt);

    error EmptyContractName();

    constructor(address admin, string memory uri, bytes32 hash) Ownable(admin) {
        camURI = uri;
        camHash = hash;

        emit CamUpdated(uri, hash);
    }

    /// @inheritdoc IERC165
    function supportsInterface(bytes4 interfaceId) external pure override returns (bool) {
        return interfaceId == type(ICamApp).interfaceId || interfaceId == type(IERC165).interfaceId;
    }

    /// @notice Updates the CAM served by this root contract.
    ///
    /// `hash` should be `keccak256` of the exact CAM document bytes.
    /// Use `bytes32(0)` only for intentionally mutable or unpinned CAMs.
    function setCam(string calldata uri, bytes32 hash) external onlyOwner {
        camURI = uri;
        camHash = hash;

        emit CamUpdated(uri, hash);
    }

    /// @notice Resolves a CAM contract name to this chain's deployed address.
    function contractAddress(string calldata contractName) external view returns (address) {
        return _contractAddress[keccak256(bytes(contractName))];
    }

    /// @notice Resolves a precomputed CAM contract-name hash.
    function contractAddressByHash(bytes32 contractNameHash) external view returns (address) {
        return _contractAddress[contractNameHash];
    }

    /// @notice Sets, updates, or clears the address for a CAM contract name.
    function setContractAddress(string calldata contractName, address deployedAt) external onlyOwner {
        if (bytes(contractName).length == 0) revert EmptyContractName();

        bytes32 contractNameHash = keccak256(bytes(contractName));
        _contractAddress[contractNameHash] = deployedAt;

        emit ContractAddressSet(contractNameHash, contractName, deployedAt);
    }
}
