import { assertPublishedCamRootURI } from "../../packages/cam-protocol/dist/index.js"
import { inspectReleaseCamBundle } from "../release-cam-bundle.ts"
import { parseDeploymentArtifact } from "./shared.ts"
import { readBoundedRegularFile, writeNewJson } from "../release-files.ts"
import { requiredEnv, requiredSourceCommit, runReleaseTool } from "../release-values.ts"

const MAX_BYTES = 1024 * 1024
async function main(): Promise<void> {
  const env = process.env
  const artifact = parseDeploymentArtifact(await readBoundedRegularFile(requiredEnv(env, "BIKE_NFT_DEPLOYMENT_ARTIFACT_PATH"), "deployment artifact", MAX_BYTES))
  const expectedCommit = requiredSourceCommit(requiredEnv(env, "BIKE_NFT_RELEASE_EXPECTED_SOURCE_COMMIT"))
  if (artifact.sourceCommit !== expectedCommit) throw new Error(`deployment source commit mismatch: expected ${expectedCommit}, got ${artifact.sourceCommit}`)
  assertPublishedCamRootURI(artifact.camURI, "deployment camURI")
  const bundle = await inspectReleaseCamBundle({
    dappsRootPath: requiredEnv(env, "BIKE_NFT_RELEASE_DAPPS_ROOT"), rootPath: requiredEnv(env, "BIKE_NFT_RELEASE_CAM_ROOT_PATH"),
    camURI: artifact.camURI, label: "Bike NFT",
  })
  if (bundle.camHash.toLowerCase() !== artifact.camHash.toLowerCase()) throw new Error(`deployment CAM hash does not match checked-in root bytes: expected ${bundle.camHash}, got ${artifact.camHash}`)
  await writeNewJson(requiredEnv(env, "BIKE_NFT_VERIFIED_ARTIFACT_PATH"), artifact, "verified deployment artifact")
  process.stdout.write(`${JSON.stringify({ event: "bike_nft_release_input_verified", sourceCommit: artifact.sourceCommit, chainId: artifact.chainId })}\n`)
}
runReleaseTool(main)
