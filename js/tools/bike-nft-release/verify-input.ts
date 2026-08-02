import { parseDeploymentArtifact } from "./shared.ts"
import { stageVerifiedReleaseArtifact } from "../release-verification-input.ts"
import { requiredEnv, requiredSourceCommit, runReleaseTool } from "../release-values.ts"

async function main(): Promise<void> {
  const env = process.env
  const expectedCommit = requiredSourceCommit(requiredEnv(env, "BIKE_NFT_RELEASE_EXPECTED_SOURCE_COMMIT"))
  const artifact = await stageVerifiedReleaseArtifact({
    artifactPath: requiredEnv(env, "BIKE_NFT_DEPLOYMENT_ARTIFACT_PATH"),
    parseArtifact: parseDeploymentArtifact,
    expectedSourceCommit: expectedCommit,
    dappsRootPath: requiredEnv(env, "BIKE_NFT_RELEASE_DAPPS_ROOT"),
    rootPath: requiredEnv(env, "BIKE_NFT_RELEASE_CAM_ROOT_PATH"),
    snapshotPath: requiredEnv(env, "BIKE_NFT_VERIFIED_ARTIFACT_PATH"),
    label: "Bike NFT",
  })
  process.stdout.write(`${JSON.stringify({ event: "bike_nft_release_input_verified", sourceCommit: artifact.sourceCommit, chainId: artifact.chainId })}\n`)
}
runReleaseTool(main)
