pragma solidity 0.8.35;

import {IERC165} from "@openzeppelin-contracts-5.6.1/utils/introspection/IERC165.sol";
import {ICamApp} from "cam/src/ICamApp.sol";
import {CamRoot} from "cam/src/CamRoot.sol";
import {PayToPlay} from "../src/PayToPlay.sol";
import {PayToPlayUI} from "../src/PayToPlayUI.sol";
import {PayToPlayUIDeployment} from "./PayToPlayUIDeployment.sol";

/// @notice Read-only acceptance checks against the selected compiler source and live deployment.
abstract contract PayToPlayReleaseVerifier is PayToPlayUIDeployment {
    struct Artifact {
        string sourceCommit;
        uint256 chainId;
        string camURI;
        bytes32 camHash;
        address intendedCamRootOwner;
        address intendedPaymentAdmin;
        uint64 nullClaimPeriod;
        address deployer;
        address camRoot;
        address payToPlay;
        address payToPlayUI;
        bytes32 camRootCodeHash;
        bytes32 payToPlayCodeHash;
        bytes32 payToPlayCreationInputHash;
        bytes32 payToPlayUICodeHash;
        bytes32 payToPlayUICreationInputHash;
    }

    error ReleaseVerificationFailed(string field);

    function verifyArtifact(Artifact memory artifact, string memory sourceCommit) internal {
        _require(keccak256(bytes(artifact.sourceCommit)) == keccak256(bytes(sourceCommit)), "sourceCommit");
        _require(
            block.chainid == artifact.chainId && artifact.chainId != 0 && artifact.chainId != 1337
                && artifact.chainId != 31337,
            "chainId"
        );
        _require(
            artifact.camRoot != address(0) && artifact.payToPlay != address(0) && artifact.payToPlayUI != address(0)
                && artifact.camRoot != artifact.payToPlay && artifact.payToPlayUI != artifact.camRoot
                && artifact.payToPlayUI != artifact.payToPlay,
            "contract addresses"
        );
        _require(
            artifact.deployer != address(0) && artifact.intendedCamRootOwner != address(0)
                && artifact.intendedPaymentAdmin != address(0),
            "authorities"
        );
        _require(artifact.camRoot.code.length != 0 && artifact.payToPlay.code.length != 0, "deployed code");
        _require(artifact.camRoot.codehash == artifact.camRootCodeHash, "CamRoot runtime hash");
        _require(artifact.payToPlay.codehash == artifact.payToPlayCodeHash, "PayToPlay runtime hash");
        _verifyRoot(artifact);
        _verifyPayments(artifact);
        _verifyUI(artifact);
    }

    function _verifyRoot(Artifact memory artifact) private {
        CamRoot root = CamRoot(artifact.camRoot);
        _require(
            root.owner() == artifact.intendedCamRootOwner && root.pendingOwner() == address(0), "CamRoot ownership"
        );
        ICamApp.ManifestRef memory manifest = root.camManifest();
        _require(
            bytes(artifact.camURI).length != 0 && keccak256(bytes(manifest.uri)) == keccak256(bytes(artifact.camURI)),
            "CAM URI"
        );
        _require(manifest.sha256Digest == artifact.camHash, "CAM digest");
        _require(root.contractAddress("PayToPlay") == artifact.payToPlay, "PayToPlay binding");
        _require(root.contractAddress("PayToPlayUI") == artifact.payToPlayUI, "PayToPlayUI binding");
        _require(
            root.supportsInterface(type(ICamApp).interfaceId) && root.supportsInterface(type(IERC165).interfaceId),
            "CamRoot interfaces"
        );
        CamRoot referenceRoot = new CamRoot(artifact.intendedCamRootOwner, artifact.camURI, artifact.camHash);
        _require(address(referenceRoot).codehash == artifact.camRoot.codehash, "CamRoot source");
    }

    function _verifyPayments(Artifact memory artifact) private view {
        PayToPlay payments = PayToPlay(payable(artifact.payToPlay));
        _require(
            payments.owner() == artifact.intendedPaymentAdmin && payments.pendingOwner() == address(0),
            "PayToPlay ownership"
        );
        // EIP712 embeds address(this) in runtime code; compare the observed CREATE input to compiler output instead.
        bytes32 expectedInputHash = keccak256(
            abi.encodePacked(type(PayToPlay).creationCode, abi.encode(artifact.deployer, artifact.nullClaimPeriod))
        );
        _require(artifact.payToPlayCreationInputHash == expectedInputHash, "PayToPlay creation source");
        _require(payments.asset() == 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE, "native asset");
        PayToPlay.Channel memory reserved = payments.channel(0);
        _require(reserved.payee == address(0) && reserved.claimPeriod == artifact.nullClaimPeriod, "reserved channel");
        (
            bytes1 fields,
            string memory name,
            string memory version,
            uint256 chainId,
            address verifyingContract,
            bytes32 salt,
            uint256[] memory extensions
        ) = payments.eip712Domain();
        _require(
            fields == 0x0f && keccak256(bytes(name)) == keccak256("PayToPlay")
                && keccak256(bytes(version)) == keccak256("2"),
            "EIP712 domain"
        );
        _require(
            chainId == artifact.chainId && verifyingContract == artifact.payToPlay && salt == bytes32(0)
                && extensions.length == 0,
            "EIP712 deployment"
        );
    }

    function _verifyUI(Artifact memory artifact) private {
        _require(artifact.payToPlayUI.code.length != 0, "PayToPlayUI deployed code");
        _require(artifact.payToPlayUI.codehash == artifact.payToPlayUICodeHash, "PayToPlayUI runtime hash");
        _require(
            address(PayToPlayUI(artifact.payToPlayUI).payments()) == artifact.payToPlay, "PayToPlayUI payment contract"
        );
        _require(
            artifact.payToPlayUICreationInputHash
                == keccak256(abi.encodePacked(type(PayToPlayUI).creationCode, abi.encode(artifact.payToPlay))),
            "PayToPlayUI creation source"
        );
        _require(payToPlayUISourceCodeHash(artifact.payToPlay) == artifact.payToPlayUI.codehash, "PayToPlayUI source");
    }

    function _require(bool condition, string memory field) private pure {
        if (!condition) revert ReleaseVerificationFailed(field);
    }
}
