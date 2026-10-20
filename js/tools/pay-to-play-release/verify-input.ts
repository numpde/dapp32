import { parseDeploymentArtifact } from "./shared.ts"
import { stageVerifiedReleaseArtifact } from "../release-verification-input.ts"
import { requiredEnv } from "../input.ts"
import { requiredSourceCommit, runReleaseTool } from "../release-values.ts"

async function main(): Promise<void> {
  const artifactPath = requiredEnv(process.env, "PAY_TO_PLAY_DEPLOYMENT_ARTIFACT_PATH")
  const expectedSourceCommit = requiredSourceCommit(
    requiredEnv(process.env, "PAY_TO_PLAY_RELEASE_EXPECTED_SOURCE_COMMIT"),
  )
  const artifact = await stageVerifiedReleaseArtifact({
    artifactPath,
    parseArtifact: parseDeploymentArtifact,
    expectedSourceCommit,
    dappsRootPath: requiredEnv(process.env, "PAY_TO_PLAY_RELEASE_DAPPS_ROOT"),
    rootPath: requiredEnv(process.env, "PAY_TO_PLAY_RELEASE_CAM_ROOT_PATH"),
    snapshotPath: requiredEnv(process.env, "PAY_TO_PLAY_VERIFIED_ARTIFACT_PATH"),
    label: "pay-to-play",
  })

  process.stdout.write(`${JSON.stringify({
    event: "pay-to-play_release_input_verified",
    sourceCommit: artifact.sourceCommit,
    chainId: artifact.chainId,
    camURI: artifact.camURI,
    camHash: artifact.camHash,
    intendedCamRootOwner: artifact.intendedCamRootOwner,
    intendedPaymentAdmin: artifact.intendedPaymentAdmin,
    nullClaimPeriod: artifact.nullClaimPeriod,
  })}\n`)
}

runReleaseTool(main)
