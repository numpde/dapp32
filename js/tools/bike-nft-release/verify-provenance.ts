import { createPublicClient, http } from "viem"
import { creationReceiptDeployer } from "./artifact-model.ts"
import { parseDeploymentArtifact, requiredEnv } from "./shared.ts"
import { readBoundedRegularFile } from "../release-files.ts"

const MAX_BYTES = 1024 * 1024
async function main(): Promise<void> {
  const env = process.env
  const artifact = parseDeploymentArtifact(await readBoundedRegularFile(requiredEnv(env, "BIKE_NFT_DEPLOYMENT_ARTIFACT_PATH"), "deployment artifact", MAX_BYTES))
  const client = createPublicClient({ transport: http(requiredEnv(env, "BIKE_NFT_RELEASE_RPC_URL")) })
  const chainId = await client.getChainId()
  if (chainId !== artifact.chainId) throw new Error(`release RPC chain mismatch: expected ${artifact.chainId}, got ${chainId}`)
  const contracts = [
    { label: "CamRoot", address: artifact.camRoot, transactionHash: artifact.camRootCreationTransaction },
    { label: "BicycleComponents", address: artifact.components, transactionHash: artifact.componentsCreationTransaction },
    { label: "BicycleComponentManager", address: artifact.manager, transactionHash: artifact.managerCreationTransaction },
    { label: "BicycleComponentManagerUI", address: artifact.ui, transactionHash: artifact.uiCreationTransaction },
  ] as const
  const receipts = await Promise.all(contracts.map((contract) => client.getTransactionReceipt({ hash: contract.transactionHash })))
  const deployers = contracts.map((contract, index) => creationReceiptDeployer(contract, receipts[index]!, contract.label).toLowerCase())
  if (new Set(deployers).size !== 1 || deployers[0] !== artifact.deployer.toLowerCase()) throw new Error(`release creation transaction deployer mismatch: expected ${artifact.deployer}`)
  process.stdout.write(`${JSON.stringify({ event: "bike_nft_release_provenance_verified", chainId, deployer: artifact.deployer })}\n`)
}
main().catch((error: unknown) => {
  const message = error instanceof Error && error.stack !== undefined
    ? error.stack
    : error instanceof Error ? error.message : String(error)
  process.stderr.write(`${message}\n`)
  process.exitCode = 1
})
