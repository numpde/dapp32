import { createPublicClient, http } from "viem"
import { parseDeploymentArtifact } from "./shared.ts"
import { readBoundedRegularFile } from "../release-files.ts"
import { observeReleaseCreations } from "../release-provenance.ts"
import { requiredEnv } from "../input.ts"
import { assertAddress, runReleaseTool } from "../release-values.ts"

const MAX_BYTES = 1024 * 1024
async function main(): Promise<void> {
  const env = process.env
  const artifact = parseDeploymentArtifact(await readBoundedRegularFile(requiredEnv(env, "BIKE_NFT_DEPLOYMENT_ARTIFACT_PATH"), "deployment artifact", MAX_BYTES))
  const client = createPublicClient({ transport: http(requiredEnv(env, "BIKE_NFT_RELEASE_RPC_URL")) })
  const contracts = [
    { label: "CamRoot", address: artifact.camRoot, transactionHash: artifact.camRootCreationTransaction },
    { label: "BicycleComponents", address: artifact.components, transactionHash: artifact.componentsCreationTransaction },
    { label: "BicycleComponentManager", address: artifact.manager, transactionHash: artifact.managerCreationTransaction },
    { label: "BicycleComponentManagerUI", address: artifact.ui, transactionHash: artifact.uiCreationTransaction },
  ] as const
  const { chainId, deployer } = await observeReleaseCreations({ client, expectedChainId: artifact.chainId, contracts })
  assertAddress(deployer, artifact.deployer, "release creation transaction deployer")
  process.stdout.write(`${JSON.stringify({ event: "bike_nft_release_provenance_verified", chainId, deployer: artifact.deployer })}\n`)
}
runReleaseTool(main)
