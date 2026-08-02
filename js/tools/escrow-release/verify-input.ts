import { parseDeploymentArtifact } from "./shared.ts"
import { stageVerifiedReleaseArtifact } from "../release-verification-input.ts"
import { requiredEnv, requiredSourceCommit, runReleaseTool } from "../release-values.ts"

async function main(): Promise<void> {
  const artifactPath = requiredEnv(process.env, "ESCROW_DEPLOYMENT_ARTIFACT_PATH")
  const expectedSourceCommit = requiredSourceCommit(
    requiredEnv(process.env, "ESCROW_RELEASE_EXPECTED_SOURCE_COMMIT"),
  )
  const artifact = await stageVerifiedReleaseArtifact({
    artifactPath,
    parseArtifact: parseDeploymentArtifact,
    expectedSourceCommit,
    dappsRootPath: requiredEnv(process.env, "ESCROW_RELEASE_DAPPS_ROOT"),
    rootPath: requiredEnv(process.env, "ESCROW_RELEASE_CAM_ROOT_PATH"),
    snapshotPath: requiredEnv(process.env, "ESCROW_VERIFIED_ARTIFACT_PATH"),
    label: "escrow",
  })

  process.stdout.write(`${JSON.stringify({
    event: "escrow_release_input_verified",
    sourceCommit: artifact.sourceCommit,
    chainId: artifact.chainId,
    camURI: artifact.camURI,
    camHash: artifact.camHash,
    intendedCamRootOwner: artifact.intendedCamRootOwner,
  })}\n`)
}

runReleaseTool(main)
