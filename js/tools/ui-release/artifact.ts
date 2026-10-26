import { resolve } from "node:path"
import { createPublicClient, encodeDeployData, getAddress, http, keccak256, toHex } from "viem"
import { requiredEnv } from "../input.ts"
import { readBoundedRegularFile, writeNewJson } from "../release-files.ts"
import { ARTIFACTS, parseReferenceSnapshot, sha256 } from "../release-approval/reference-read.ts"
import { createdContract, creationReceiptDeployer, creationTransactionInputHash } from "../release-provenance.ts"
import { parseJsonRecord, runReleaseTool } from "../release-values.ts"
import { parseUIReleasePlan, UI_SCRIPT_NAME, verifyUIBacking, type UIDeploymentArtifact } from "./shared.ts"

async function main(): Promise<void> {
  const env = process.env
  if (env.UI_RELEASE_PHASE === "verify-block") {
    const candidate = parseJsonRecord(await readBoundedRegularFile(requiredEnv(env, "UI_RELEASE_CANDIDATE_PATH"),
      "UI deployment candidate", 1024 * 1024), "UI deployment candidate")
    const verificationBlock = candidate.verificationBlock as UIDeploymentArtifact["verificationBlock"]
    const client = createPublicClient({ transport: http(requiredEnv(env, "UI_RELEASE_RPC_URL")) })
    if ((await client.getBlock({ blockNumber: BigInt(verificationBlock.number) })).hash !== verificationBlock.hash) {
      throw new Error("The UI verification block changed during native source verification")
    }
    return
  }
  const planBytes = await readBoundedRegularFile(requiredEnv(env, "UI_RELEASE_PLAN_PATH"), "UI release plan", 64 * 1024)
  const plan = parseUIReleasePlan(planBytes)
  const reference = parseReferenceSnapshot(await readBoundedRegularFile(requiredEnv(env, "UI_RELEASE_REFERENCE_PATH"), "UI approval reference", 1024 * 1024))
  if (reference.schema !== "release-approval.ui-reference.v1" || reference.app !== plan.app
      || reference.sourceCommit !== plan.sourceCommit || reference.expectedChainId !== plan.expectedChainId
      || reference.planSha256 !== sha256(planBytes) || JSON.stringify(reference.backing) !== JSON.stringify(plan.backing)) {
    throw new Error("Cannot collect UI deployment: the independent approval reference differs from its saved plan")
  }
  const path = resolve(requiredEnv(env, "UI_RELEASE_BROADCAST_DIR"), UI_SCRIPT_NAME, String(plan.expectedChainId), "run-latest.json")
  const broadcast = parseJsonRecord(await readBoundedRegularFile(path, "UI Forge broadcast", 16 * 1024 * 1024), "UI Forge broadcast")
  if (!Array.isArray(broadcast.transactions) || broadcast.transactions.length !== 1) throw new Error("UI deployment must contain exactly one contract creation and no other transactions")
  const creation = createdContract(broadcast.transactions, ARTIFACTS[plan.app].ui!.contract)
  const client = createPublicClient({ transport: http(requiredEnv(env, "UI_RELEASE_RPC_URL")) })
  const backingObservation = await verifyUIBacking(client, plan.backing)
  const [receipt, transaction] = await Promise.all([
    client.getTransactionReceipt({ hash: creation.transactionHash }),
    client.getTransaction({ hash: creation.transactionHash }),
  ])
  const creator = getAddress(creationReceiptDeployer(creation, receipt, "UI"))
  if (getAddress(creator) !== getAddress(reference.expectedDeployer)) throw new Error("UI creation receipt names a different creator from the approved transaction")
  const creationInputHash = creationTransactionInputHash(creation, transaction, creator, "UI")
  const compiled = reference.contracts[0]!
  const expectedInput = encodeDeployData({ abi: compiled.abi, bytecode: compiled.creationBytecode, args: [plan.backing.address] })
  if (creationInputHash !== keccak256(expectedInput)) throw new Error("UI creation input differs from the independently compiled source and backing address")
  const blockNumber = BigInt(backingObservation.blockNumber)
  const [code, creationBlock] = await Promise.all([
    client.getCode({ address: creation.address, blockNumber }),
    client.getBlock({ blockNumber: receipt.blockNumber }),
  ])
  if (code === undefined || code === "0x") throw new Error("The created UI has no deployed runtime at the verification block")
  if (creationBlock.hash !== receipt.blockHash || (await client.getBlock({ blockNumber })).hash !== backingObservation.blockHash) {
    throw new Error("The UI creation or verification block changed during artifact collection")
  }
  const candidate: UIDeploymentArtifact = {
    schema: "cam.ui-deployment.v1", app: plan.app, sourceCommit: plan.sourceCommit,
    chainId: plan.expectedChainId, creator, planSha256: reference.planSha256, referenceSha256: reference.snapshotSha256,
    backing: plan.backing,
    ui: { address: creation.address, creationTransaction: creation.transactionHash, creationInputHash, codeHash: keccak256(code) },
    verificationBlock: { number: toHex(blockNumber), hash: backingObservation.blockHash },
  }
  await writeNewJson(requiredEnv(env, "UI_RELEASE_CANDIDATE_PATH"), candidate, "UI deployment candidate")
  process.stdout.write(`${JSON.stringify({ event: "ui_deployment_observed", app: plan.app, ui: creation.address,
    creator, backing: plan.backing.address, sourceCommit: plan.sourceCommit, verificationBlock: candidate.verificationBlock })}\n`)
}

runReleaseTool(main)
