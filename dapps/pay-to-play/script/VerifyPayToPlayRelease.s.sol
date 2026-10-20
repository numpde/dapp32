pragma solidity 0.8.35;

import {Script, console2} from "forge-std-1.12.0/src/Script.sol";
import {PayToPlayReleaseVerifier} from "./PayToPlayReleaseVerifier.sol";

/// @notice Verifies the immutable artifact snapshot without signing or broadcasting.
contract VerifyPayToPlayRelease is Script, PayToPlayReleaseVerifier {
    function run() external {
        Artifact memory artifact = _readArtifact(vm.envString("PAY_TO_PLAY_VERIFIED_DEPLOYMENT_PATH"));
        verifyArtifact(artifact, vm.envString("PAY_TO_PLAY_RELEASE_EXPECTED_SOURCE_COMMIT"));
        console2.log("PayToPlayReleaseVerified", true);
        console2.log("CamRoot", artifact.camRoot);
        console2.log("PayToPlay", artifact.payToPlay);
    }

    function _readArtifact(string memory path) internal view returns (Artifact memory artifact) {
        string memory json = vm.readFile(path);
        artifact.sourceCommit = vm.parseJsonString(json, ".sourceCommit");
        artifact.chainId = vm.parseJsonUint(json, ".chainId");
        artifact.camURI = vm.parseJsonString(json, ".camURI");
        artifact.camHash = vm.parseJsonBytes32(json, ".camHash");
        artifact.intendedCamRootOwner = vm.parseJsonAddress(json, ".intendedCamRootOwner");
        artifact.intendedPaymentAdmin = vm.parseJsonAddress(json, ".intendedPaymentAdmin");
        uint256 period = vm.parseJsonUint(json, ".nullClaimPeriod");
        if (period > 30 days) revert ReleaseVerificationFailed("nullClaimPeriod");
        artifact.nullClaimPeriod = uint64(period);
        artifact.deployer = vm.parseJsonAddress(json, ".deployer");
        artifact.camRoot = vm.parseJsonAddress(json, ".camRoot");
        artifact.payToPlay = vm.parseJsonAddress(json, ".payToPlay");
        artifact.camRootCodeHash = vm.parseJsonBytes32(json, ".camRootCodeHash");
        artifact.payToPlayCodeHash = vm.parseJsonBytes32(json, ".payToPlayCodeHash");
        artifact.payToPlayCreationInputHash = vm.parseJsonBytes32(json, ".payToPlayCreationInputHash");
    }
}
