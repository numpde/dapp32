import { createPublicClient, http } from "viem"
import { parseDeploymentArtifact } from "./shared.ts"
import { creationReceiptDeployer, creationTransactionInputHash } from "../release-provenance.ts"
import { readBoundedRegularFile } from "../release-files.ts"
import { requiredEnv } from "../input.ts"
import { assertAddress, assertEqual, runReleaseTool } from "../release-values.ts"

async function main(): Promise<void> {
  const artifact = parseDeploymentArtifact(await readBoundedRegularFile(requiredEnv(process.env, "PAY_TO_PLAY_DEPLOYMENT_ARTIFACT_PATH"), "deployment artifact", 1024 * 1024))
  const client = createPublicClient({ transport: http(requiredEnv(process.env, "PAY_TO_PLAY_RELEASE_RPC_URL")) })
  const chainId = await client.getChainId()
  if (chainId !== artifact.chainId) throw new Error(`release RPC chain mismatch: expected ${artifact.chainId}, got ${chainId}`)
  const root = { address: artifact.camRoot, transactionHash: artifact.camRootCreationTransaction }
  const payments = { address: artifact.payToPlay, transactionHash: artifact.payToPlayCreationTransaction }
  const [rootReceipt, paymentReceipt, transaction] = await Promise.all([
    client.getTransactionReceipt({ hash: root.transactionHash }),
    client.getTransactionReceipt({ hash: payments.transactionHash }),
    client.getTransaction({ hash: payments.transactionHash }),
  ])
  assertAddress(creationReceiptDeployer(root, rootReceipt, "CamRoot"), artifact.deployer, "CamRoot deployer")
  assertAddress(creationReceiptDeployer(payments, paymentReceipt, "PayToPlay"), artifact.deployer, "PayToPlay deployer")
  assertEqual(creationTransactionInputHash(payments, transaction, artifact.deployer, "PayToPlay"), artifact.payToPlayCreationInputHash, "PayToPlay creation input hash")
  process.stdout.write(`${JSON.stringify({ event: "pay_to_play_release_provenance_verified", chainId, deployer: artifact.deployer })}\n`)
}
runReleaseTool(main)
