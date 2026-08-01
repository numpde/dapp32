pragma solidity 0.8.35;

import {Script, console2} from "forge-std-1.12.0/src/Script.sol";

import {EscrowReleaseVerifier} from "./EscrowReleaseVerifier.sol";

/// @notice Verifies one deployment artifact against one live read-only RPC.
/// @dev Run without `--broadcast`. Reference deployments exist only in Forge's
/// simulation and no private key is accepted by the verification lane.
contract VerifyEscrowRelease is Script, EscrowReleaseVerifier {
    function run() external {
        requireDeploymentSchema(vm.envString("ESCROW_DEPLOYMENT_SCHEMA"));
        Artifact memory artifact = _readEnvironment();
        string memory expectedSourceCommit = vm.envString("ESCROW_RELEASE_EXPECTED_SOURCE_COMMIT");
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

    function _readEnvironment() private view returns (Artifact memory artifact) {
        artifact.sourceCommit = vm.envString("ESCROW_DEPLOYMENT_SOURCE_COMMIT");
        artifact.chainId = vm.envUint("ESCROW_DEPLOYMENT_CHAIN_ID");
        artifact.camURI = vm.envString("ESCROW_DEPLOYMENT_CAM_URI");
        artifact.camHash = vm.envBytes32("ESCROW_DEPLOYMENT_CAM_HASH");
        artifact.intendedCamRootOwner = vm.envAddress("ESCROW_DEPLOYMENT_CAM_ROOT_OWNER");
        artifact.camRoot = vm.envAddress("ESCROW_DEPLOYMENT_CAM_ROOT");
        artifact.camEscrow = vm.envAddress("ESCROW_DEPLOYMENT_CAM_ESCROW");
        artifact.camEscrowUI = vm.envAddress("ESCROW_DEPLOYMENT_CAM_ESCROW_UI");
        artifact.camRootCodeHash = vm.envBytes32("ESCROW_DEPLOYMENT_CAM_ROOT_CODE_HASH");
        artifact.camEscrowCodeHash = vm.envBytes32("ESCROW_DEPLOYMENT_CAM_ESCROW_CODE_HASH");
        artifact.camEscrowUICodeHash = vm.envBytes32("ESCROW_DEPLOYMENT_CAM_ESCROW_UI_CODE_HASH");
    }
}
