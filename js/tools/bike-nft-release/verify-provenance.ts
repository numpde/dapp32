import { lstat, readFile } from "node:fs/promises"
import { createPublicClient, http } from "viem"
import { creationReceiptDeployer } from "./artifact-model.ts"
import { deploymentArguments, parseDeploymentArtifact, requiredEnv } from "./shared.ts"

const MAX_BYTES = 1024 * 1024
async function main(): Promise<void> {
  const env = process.env
  const artifact = parseDeploymentArtifact(await readRegularFile(requiredEnv(env, "BIKE_NFT_DEPLOYMENT_ARTIFACT_PATH"), "deployment artifact"))
  const argumentsText = new TextDecoder().decode(await readRegularFile(requiredEnv(env, "BIKE_NFT_DEPLOYMENT_ARGUMENTS_PATH"), "deployment arguments"))
  if (argumentsText !== deploymentArguments(artifact)) throw new Error("deployment arguments do not exactly match deployment.json")
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
async function readRegularFile(path: string, label: string): Promise<Uint8Array> { const stat = await lstat(path); if (stat.isSymbolicLink() || !stat.isFile()) throw new Error(`${label} must be a regular non-symlink file: ${path}`); if (stat.size > MAX_BYTES) throw new Error(`${label} exceeds ${MAX_BYTES} bytes`); return new Uint8Array(await readFile(path)) }
main().catch((error: unknown) => {
  const message = error instanceof Error && error.stack !== undefined
    ? error.stack
    : error instanceof Error ? error.message : String(error)
  process.stderr.write(`${message}\n`)
  process.exitCode = 1
})
