import { lstat, readFile } from "node:fs/promises"
import { assertPublishedCamRootURI } from "../../packages/cam-protocol/dist/index.js"
import { buildReleasePlan } from "./bundle.ts"
import { deploymentArguments, parseDeploymentArtifact, requiredEnv, requiredSourceCommit } from "./shared.ts"

const MAX_BYTES = 1024 * 1024
async function main(): Promise<void> {
  const env = process.env
  const artifact = parseDeploymentArtifact(await readRegularFile(requiredEnv(env, "BIKE_NFT_DEPLOYMENT_ARTIFACT_PATH"), "deployment artifact"))
  const expectedCommit = requiredSourceCommit(requiredEnv(env, "BIKE_NFT_RELEASE_EXPECTED_SOURCE_COMMIT"))
  if (artifact.sourceCommit !== expectedCommit) throw new Error(`deployment source commit mismatch: expected ${expectedCommit}, got ${artifact.sourceCommit}`)
  const argumentsText = new TextDecoder().decode(await readRegularFile(requiredEnv(env, "BIKE_NFT_DEPLOYMENT_ARGUMENTS_PATH"), "deployment arguments"))
  if (argumentsText !== deploymentArguments(artifact)) throw new Error("deployment arguments do not exactly match deployment.json")
  assertPublishedCamRootURI(artifact.camURI, "deployment camURI")
  const sourcePlan = await buildReleasePlan({
    dappsRootPath: requiredEnv(env, "BIKE_NFT_RELEASE_DAPPS_ROOT"), rootPath: requiredEnv(env, "BIKE_NFT_RELEASE_CAM_ROOT_PATH"),
    sourceCommit: artifact.sourceCommit, expectedChainId: artifact.chainId, camURI: artifact.camURI,
    camRootOwner: artifact.camRootOwner, tokenName: artifact.tokenName, tokenSymbol: artifact.tokenSymbol,
    baseTokenURI: artifact.baseTokenURI, collectionURI: artifact.collectionURI,
    componentsAdmin: artifact.componentsAdmin, componentsAdminDelay: artifact.componentsAdminDelay,
    componentsPauser: artifact.componentsPauser, componentsConfigurer: artifact.componentsConfigurer,
    managerAdmin: artifact.managerAdmin, managerAdminDelay: artifact.managerAdminDelay,
    managerPauser: artifact.managerPauser, managerConfigurer: artifact.managerConfigurer, registrars: artifact.registrars,
  })
  if (sourcePlan.camHash.toLowerCase() !== artifact.camHash.toLowerCase()) throw new Error(`deployment CAM hash does not match checked-in root bytes: expected ${sourcePlan.camHash}, got ${artifact.camHash}`)
  process.stdout.write(`${JSON.stringify({ event: "bike_nft_release_input_verified", sourceCommit: artifact.sourceCommit, chainId: artifact.chainId })}\n`)
}
async function readRegularFile(path: string, label: string): Promise<Uint8Array> { const stat = await lstat(path); if (stat.isSymbolicLink() || !stat.isFile()) throw new Error(`${label} must be a regular non-symlink file: ${path}`); if (stat.size > MAX_BYTES) throw new Error(`${label} exceeds ${MAX_BYTES} bytes`); return new Uint8Array(await readFile(path)) }
main().catch((error: unknown) => {
  const message = error instanceof Error && error.stack !== undefined
    ? error.stack
    : error instanceof Error ? error.message : String(error)
  process.stderr.write(`${message}\n`)
  process.exitCode = 1
})
