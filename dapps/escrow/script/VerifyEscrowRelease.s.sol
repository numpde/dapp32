pragma solidity 0.8.35;

import {Script, console2} from "forge-std-1.12.0/src/Script.sol";

import {EscrowReleaseVerifier} from "./EscrowReleaseVerifier.sol";

/// @notice Verifies one deployment artifact against one live read-only RPC.
/// @dev Run without `--broadcast`. Reference deployments exist only in Forge's
/// simulation and no private key is accepted by the verification lane.
contract VerifyEscrowRelease is Script, EscrowReleaseVerifier {
    function run() external {
        string memory artifactPath = vm.envString("ESCROW_DEPLOYMENT_ARTIFACT_PATH");
        string memory expectedSourceCommit = vm.envString("ESCROW_RELEASE_EXPECTED_SOURCE_COMMIT");
        string memory json = vm.readFile(artifactPath);

        requireDeploymentSchema(vm.parseJsonString(json, ".schema"));

        Artifact memory artifact = Artifact({
            sourceCommit: vm.parseJsonString(json, ".sourceCommit"),
            chainId: vm.parseJsonUint(json, ".chainId"),
            camURI: vm.parseJsonString(json, ".camURI"),
            camHash: vm.parseJsonBytes32(json, ".camHash"),
            intendedCamRootOwner: vm.parseJsonAddress(json, ".intendedCamRootOwner"),
            camRoot: vm.parseJsonAddress(json, ".camRoot"),
            camEscrow: vm.parseJsonAddress(json, ".camEscrow"),
            camEscrowUI: vm.parseJsonAddress(json, ".camEscrowUI"),
            camRootCodeHash: vm.parseJsonBytes32(json, ".camRootCodeHash"),
            camEscrowCodeHash: vm.parseJsonBytes32(json, ".camEscrowCodeHash"),
            camEscrowUICodeHash: vm.parseJsonBytes32(json, ".camEscrowUICodeHash")
        });

        verifyArtifact(artifact, expectedSourceCommit);

        console2.log("EscrowReleaseVerified", true);
        console2.log("SourceCommit", artifact.sourceCommit);
        console2.log("ChainId", artifact.chainId);
        console2.log("CamRoot", artifact.camRoot);
        console2.log("CamEscrow", artifact.camEscrow);
        console2.log("CamEscrowUI", artifact.camEscrowUI);
        console2.log("CamRootOwner", artifact.intendedCamRootOwner);
        console2.log("CamHash", artifact.camHash);
    }
}
