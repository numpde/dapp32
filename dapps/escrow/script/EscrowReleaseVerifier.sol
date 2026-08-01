pragma solidity 0.8.35;

import {IERC165} from "@openzeppelin-contracts-5.6.1/utils/introspection/IERC165.sol";

import {CamRoot} from "cam/src/CamRoot.sol";
import {ICamApp} from "cam/src/ICamApp.sol";

import {CamEscrow} from "../src/CamEscrow.sol";
import {CamEscrowUI} from "../src/CamEscrowUI.sol";
import {ICamEscrowView} from "../src/ICamEscrowView.sol";

/// @notice Exact, read-only acceptance checks for a published escrow release.
/// @dev Reference deployments occur only inside Forge's simulation and are never
/// broadcast by the verification lane. They bind bytecode checks to this source
/// tree, including CamEscrowUI's immutable escrow address.
abstract contract EscrowReleaseVerifier {
    string internal constant DEPLOYMENT_SCHEMA = "escrow.deployment.v1";
    string internal constant CAM_CONTRACT_ESCROW = "CamEscrow";
    string internal constant CAM_CONTRACT_ESCROW_UI = "CamEscrowUI";

    struct Artifact {
        string sourceCommit;
        uint256 chainId;
        string camURI;
        bytes32 camHash;
        address intendedCamRootOwner;
        address camRoot;
        address camEscrow;
        address camEscrowUI;
        bytes32 camRootCodeHash;
        bytes32 camEscrowCodeHash;
        bytes32 camEscrowUICodeHash;
    }

    error InvalidArtifactSchema(string actual);
    error SourceCommitMismatch(string expected, string actual);
    error ChainIdMismatch(uint256 expected, uint256 actual);
    error ZeroAddress(string field);
    error MissingCode(string field, address target);
    error CodeHashMismatch(string field, bytes32 expected, bytes32 actual);
    error CamURIMismatch(string expected, string actual);
    error CamHashMismatch(bytes32 expected, bytes32 actual);
    error CamRootOwnerMismatch(address expected, address actual);
    error CamRootOwnershipPending(address pendingOwner);
    error ContractBindingMismatch(string contractName, address expected, address actual);
    error ProjectionBackingMismatch(address expected, address actual);
    error UnsupportedInterface(string target, bytes4 interfaceId);
    error InsolventEscrow(uint256 liabilities, uint256 balance);

    function verifyArtifact(Artifact memory artifact, string memory expectedSourceCommit) internal {
        if (keccak256(bytes(artifact.sourceCommit)) != keccak256(bytes(expectedSourceCommit))) {
            revert SourceCommitMismatch(expectedSourceCommit, artifact.sourceCommit);
        }
        if (artifact.chainId != block.chainid) {
            revert ChainIdMismatch(artifact.chainId, block.chainid);
        }

        _requireAddress("camRoot", artifact.camRoot);
        _requireAddress("camEscrow", artifact.camEscrow);
        _requireAddress("camEscrowUI", artifact.camEscrowUI);
        _requireAddress("intendedCamRootOwner", artifact.intendedCamRootOwner);
        _requireCode("camRoot", artifact.camRoot);
        _requireCode("camEscrow", artifact.camEscrow);
        _requireCode("camEscrowUI", artifact.camEscrowUI);

        CamRoot root = CamRoot(artifact.camRoot);
        CamEscrow escrow = CamEscrow(payable(artifact.camEscrow));
        CamEscrowUI ui = CamEscrowUI(payable(artifact.camEscrowUI));

        _requireString("camURI", artifact.camURI, root.camURI());
        if (root.camHash() != artifact.camHash) {
            revert CamHashMismatch(artifact.camHash, root.camHash());
        }
        if (root.owner() != artifact.intendedCamRootOwner) {
            revert CamRootOwnerMismatch(artifact.intendedCamRootOwner, root.owner());
        }
        if (root.pendingOwner() != address(0)) {
            revert CamRootOwnershipPending(root.pendingOwner());
        }

        _requireBinding(root, CAM_CONTRACT_ESCROW, artifact.camEscrow);
        _requireBinding(root, CAM_CONTRACT_ESCROW_UI, artifact.camEscrowUI);
        if (address(ui.escrow()) != artifact.camEscrow) {
            revert ProjectionBackingMismatch(artifact.camEscrow, address(ui.escrow()));
        }

        _requireInterface("CamRoot ICamApp", artifact.camRoot, type(ICamApp).interfaceId);
        _requireInterface("CamRoot IERC165", artifact.camRoot, type(IERC165).interfaceId);
        _requireInterface("CamEscrow ICamEscrowView", artifact.camEscrow, type(ICamEscrowView).interfaceId);
        _requireInterface("CamEscrow IERC165", artifact.camEscrow, type(IERC165).interfaceId);

        _requireCodeHash("artifact CamRoot", artifact.camRootCodeHash, artifact.camRoot.codehash);
        _requireCodeHash("artifact CamEscrow", artifact.camEscrowCodeHash, artifact.camEscrow.codehash);
        _requireCodeHash("artifact CamEscrowUI", artifact.camEscrowUICodeHash, artifact.camEscrowUI.codehash);

        CamRoot referenceRoot = new CamRoot(artifact.intendedCamRootOwner, artifact.camURI, artifact.camHash);
        CamEscrow referenceEscrow = new CamEscrow();
        CamEscrowUI referenceUI = new CamEscrowUI(artifact.camEscrow);

        _requireCodeHash("source CamRoot", address(referenceRoot).codehash, artifact.camRoot.codehash);
        _requireCodeHash("source CamEscrow", address(referenceEscrow).codehash, artifact.camEscrow.codehash);
        _requireCodeHash("source CamEscrowUI", address(referenceUI).codehash, artifact.camEscrowUI.codehash);

        uint256 liabilities = escrow.totalLiabilities();
        uint256 balance = artifact.camEscrow.balance;
        if (liabilities > balance) revert InsolventEscrow(liabilities, balance);
    }

    function requireDeploymentSchema(string memory actual) internal pure {
        if (keccak256(bytes(actual)) != keccak256(bytes(DEPLOYMENT_SCHEMA))) {
            revert InvalidArtifactSchema(actual);
        }
    }

    function _requireAddress(string memory field, address target) private pure {
        if (target == address(0)) revert ZeroAddress(field);
    }

    function _requireCode(string memory field, address target) private view {
        if (target.code.length == 0) revert MissingCode(field, target);
    }

    function _requireCodeHash(string memory field, bytes32 expected, bytes32 actual) private pure {
        if (expected != actual) revert CodeHashMismatch(field, expected, actual);
    }

    function _requireString(string memory field, string memory expected, string memory actual) private pure {
        if (keccak256(bytes(expected)) != keccak256(bytes(actual))) {
            if (keccak256(bytes(field)) == keccak256(bytes("camURI"))) {
                revert CamURIMismatch(expected, actual);
            }
            revert CamURIMismatch(expected, actual);
        }
    }

    function _requireBinding(CamRoot root, string memory contractName, address expected) private view {
        address actual = root.contractAddress(contractName);
        if (actual != expected) revert ContractBindingMismatch(contractName, expected, actual);
    }

    function _requireInterface(string memory target, address contractAddress_, bytes4 interfaceId) private view {
        bool supported;
        try IERC165(contractAddress_).supportsInterface(interfaceId) returns (bool result) {
            supported = result;
        } catch {
            supported = false;
        }
        if (!supported) revert UnsupportedInterface(target, interfaceId);
    }
}
