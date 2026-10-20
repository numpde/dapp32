import { resolve } from "node:path"
import { createPublicClient, getAddress, http, keccak256, parseAbi } from "viem"
import { DEPLOYMENT_SCHEMA, parseReleasePlan, type DeploymentArtifact } from "./shared.ts"
import { createdContract, creationReceiptDeployer, creationTransactionInputHash, sharedCreationReceiptDeployer } from "../release-provenance.ts"
import { ownershipState } from "../release-ownership.ts"
import { readBoundedRegularFile, writeNewJson } from "../release-files.ts"
import { requiredEnv } from "../input.ts"
import { assertAddress, assertEqual, parseJsonRecord, runReleaseTool } from "../release-values.ts"

const OWNABLE_ABI = parseAbi(["function owner() view returns (address)", "function pendingOwner() view returns (address)"])
const ROOT_ABI = parseAbi([
  "function camManifest() view returns ((string uri, bytes32 sha256Digest))",
  "function contractAddress(string name) view returns (address)",
])

async function main(): Promise<void> {
  const plan = parseReleasePlan(await readBoundedRegularFile(requiredEnv(process.env, "PAY_TO_PLAY_RELEASE_PLAN_PATH"), "release plan", 1024 * 1024))
  const broadcastPath = resolve(requiredEnv(process.env, "PAY_TO_PLAY_RELEASE_BROADCAST_DIR"), "DeployPayToPlayRelease.s.sol", String(plan.expectedChainId), "run-latest.json")
  const broadcast = parseJsonRecord(await readBoundedRegularFile(broadcastPath, "Forge broadcast", 16 * 1024 * 1024), "Forge broadcast")
  if (!Array.isArray(broadcast.transactions)) throw new Error("Forge broadcast must contain a transactions array")
  const root = createdContract(broadcast.transactions, "CamRoot")
  const payments = createdContract(broadcast.transactions, "PayToPlay")
  const client = createPublicClient({ transport: http(requiredEnv(process.env, "PAY_TO_PLAY_RELEASE_RPC_URL")) })
  const chainId = await client.getChainId()
  if (chainId !== plan.expectedChainId) throw new Error(`release RPC chain mismatch: expected ${plan.expectedChainId}, got ${chainId}`)
  const [rootReceipt, paymentReceipt, transaction] = await Promise.all([
    client.getTransactionReceipt({ hash: root.transactionHash }),
    client.getTransactionReceipt({ hash: payments.transactionHash }),
    client.getTransaction({ hash: payments.transactionHash }),
  ])
  const deployer = sharedCreationReceiptDeployer([
    creationReceiptDeployer(root, rootReceipt, "CamRoot"),
    creationReceiptDeployer(payments, paymentReceipt, "PayToPlay"),
  ])
  const creationInputHash = creationTransactionInputHash(payments, transaction, deployer, "PayToPlay")
  const blockNumber = await client.getBlockNumber()
  const [rootCode, paymentCode, manifest, binding] = await Promise.all([
    client.getCode({ address: root.address, blockNumber }),
    client.getCode({ address: payments.address, blockNumber }),
    client.readContract({ address: root.address, abi: ROOT_ABI, functionName: "camManifest", blockNumber }),
    client.readContract({ address: root.address, abi: ROOT_ABI, functionName: "contractAddress", args: ["PayToPlay"], blockNumber }),
  ])
  if (rootCode === undefined || rootCode === "0x") throw new Error("CamRoot has no deployed code")
  if (paymentCode === undefined || paymentCode === "0x") throw new Error("PayToPlay has no deployed code")
  assertEqual(manifest.uri, plan.camURI, "CamRoot CAM URI")
  assertEqual(manifest.sha256Digest.toLowerCase(), plan.camHash.toLowerCase(), "CamRoot CAM hash")
  assertAddress(binding, payments.address, "CamRoot PayToPlay binding")
  const ownership = await Promise.all([
    observeOwnership(root.address, plan.intendedCamRootOwner, "CamRoot"),
    observeOwnership(payments.address, plan.intendedPaymentAdmin, "PayToPlay"),
  ])
  const { expectedChainId: _expectedChainId, schema: _planSchema, ...settings } = plan
  const artifact: DeploymentArtifact = {
    ...settings, schema: DEPLOYMENT_SCHEMA, chainId, deployer,
    camRoot: root.address, payToPlay: payments.address,
    camRootCodeHash: keccak256(rootCode), payToPlayCodeHash: keccak256(paymentCode),
    camRootCreationTransaction: root.transactionHash, payToPlayCreationTransaction: payments.transactionHash,
    payToPlayCreationInputHash: creationInputHash,
  }
  const artifactPath = requiredEnv(process.env, "PAY_TO_PLAY_DEPLOYMENT_ARTIFACT_PATH")
  await writeNewJson(artifactPath, artifact, "deployment artifact")
  process.stdout.write(`${JSON.stringify({ event: "pay_to_play_deployment_artifact", artifactPath, chainId, camRoot: root.address, payToPlay: payments.address, rootOwnershipAccepted: ownership[0]!.ownershipAccepted, paymentAdminAccepted: ownership[1]!.ownershipAccepted })}\n`)

  async function observeOwnership(address: typeof root.address, intendedOwner: typeof root.address, label: string) {
    const [owner, pendingOwner] = await Promise.all([
      client.readContract({ address, abi: OWNABLE_ABI, functionName: "owner", blockNumber }),
      client.readContract({ address, abi: OWNABLE_ABI, functionName: "pendingOwner", blockNumber }),
    ])
    return ownershipState({ label, deployer, intendedOwner, owner: getAddress(owner), pendingOwner: getAddress(pendingOwner) })
  }
}

runReleaseTool(main)
