import { createPublicClient, http } from "viem"
import { parseDeploymentArtifact } from "./shared.ts"
import { observeReleaseCreations, creationTransactionInputHash } from "../release-provenance.ts"
import { readBoundedRegularFile } from "../release-files.ts"
import { requiredEnv } from "../input.ts"
import { assertAddress, assertEqual, runReleaseTool } from "../release-values.ts"

async function main(): Promise<void> {
  const artifact = parseDeploymentArtifact(await readBoundedRegularFile(requiredEnv(process.env, "PAY_TO_PLAY_DEPLOYMENT_ARTIFACT_PATH"), "deployment artifact", 1024 * 1024))
  const client = createPublicClient({ transport: http(requiredEnv(process.env, "PAY_TO_PLAY_RELEASE_RPC_URL")) })
  const root = { address: artifact.camRoot, transactionHash: artifact.camRootCreationTransaction }
  const payments = { address: artifact.payToPlay, transactionHash: artifact.payToPlayCreationTransaction }
  const ui = { address: artifact.payToPlayUI, transactionHash: artifact.payToPlayUICreationTransaction }
  const { chainId, deployer } = await observeReleaseCreations({
    client, expectedChainId: artifact.chainId,
    contracts: [{ label: "CamRoot", ...root }, { label: "PayToPlay", ...payments }, { label: "PayToPlayUI", ...ui }],
  })
  assertAddress(deployer, artifact.deployer, "release creation transaction deployer")
  const transaction = await client.getTransaction({ hash: payments.transactionHash })
  assertEqual(creationTransactionInputHash(payments, transaction, artifact.deployer, "PayToPlay"), artifact.payToPlayCreationInputHash, "PayToPlay creation input hash")
  const uiTransaction = await client.getTransaction({ hash: ui.transactionHash })
  assertEqual(creationTransactionInputHash(ui, uiTransaction, artifact.deployer, "PayToPlayUI"), artifact.payToPlayUICreationInputHash, "PayToPlayUI creation input hash")
  process.stdout.write(`${JSON.stringify({ event: "pay_to_play_release_provenance_verified", chainId, deployer: artifact.deployer })}\n`)
}
runReleaseTool(main)
