import { resolve } from "node:path"
import { isDeepStrictEqual } from "node:util"
import { createPublicClient, getAddress, http, keccak256, parseAbi, serializeTransaction, toHex, type Hex } from "viem"
import { requiredEnv } from "../input.ts"
import { readBoundedRegularFile, writeNewJson } from "../release-files.ts"
import { parseReferenceSnapshot, sha256 } from "../release-approval/reference-read.ts"
import { ReleaseVerifier } from "../release-approval/verifier.ts"
import { parseJsonRecord, requiredJsonRecord, requiredTransactionHash, runReleaseTool } from "../release-values.ts"
import { contractDeploymentReference } from "./reference.ts"
import { parseContractDeployment, parseContractReleasePlan, type ContractDeploymentArtifact, type ContractIdentity, type DelayedAdministration } from "./shared.ts"

const OWNABLE = parseAbi(["function owner() view returns (address)", "function pendingOwner() view returns (address)"])
const DELAYED_ADMIN = parseAbi(["function defaultAdmin() view returns (address)", "function pendingDefaultAdmin() view returns (address,uint48)"])

async function main(): Promise<void> {
  const env = process.env
  const client = createPublicClient({ transport: http(requiredEnv(env, "CONTRACT_RELEASE_RPC_URL")) })
  const candidatePath = requiredEnv(env, "CONTRACT_RELEASE_CANDIDATE_PATH")
  if (env.CONTRACT_RELEASE_PHASE === "verify-block") {
    const candidate = parseJsonRecord(await readBoundedRegularFile(candidatePath, "business deployment candidate", 1024 * 1024), "business deployment candidate")
    const block = candidate.verificationBlock as ContractDeploymentArtifact["verificationBlock"]
    if ((await client.getBlock({ blockNumber: BigInt(block.number) })).hash !== block.hash) {
      throw new Error("Cannot publish business deployment: its observation block changed during native source verification")
    }
    return
  }
  const planBytes = await readBoundedRegularFile(requiredEnv(env, "CONTRACT_RELEASE_PLAN_PATH"), "business release plan", 64 * 1024)
  const plan = parseContractReleasePlan(planBytes)
  const reference = parseReferenceSnapshot(await readBoundedRegularFile(requiredEnv(env, "CONTRACT_RELEASE_REFERENCE_PATH"), "business approval reference", 1024 * 1024))
  const expected = contractDeploymentReference(plan, reference.expectedDeployer)
  if (reference.schema !== "release-approval.contract-reference.v1" || reference.app !== plan.app
      || reference.sourceCommit !== plan.sourceCommit || reference.expectedChainId !== plan.expectedChainId
      || reference.planSha256 !== sha256(planBytes) || !isDeepStrictEqual(reference.steps, expected.steps)) {
    throw new Error("Cannot collect business deployment: its approval reference differs from the saved business plan")
  }
  if (await client.getChainId() !== plan.expectedChainId) throw new Error("Cannot collect business deployment: RPC chain differs from the saved plan")
  let existing: ContractDeploymentArtifact | undefined
  try {
    existing = parseContractDeployment(await readBoundedRegularFile(requiredEnv(env, "CONTRACT_RELEASE_ARTIFACT_PATH"), "existing business artifact", 1024 * 1024), plan.app)
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error }
  const blockNumber = existing === undefined ? await client.getBlockNumber() : BigInt(existing.verificationBlock.number)
  const observation = await client.getBlock({ blockNumber })
  if (observation.hash === null || (existing !== undefined && observation.hash !== existing.verificationBlock.hash)) {
    throw new Error("Cannot collect business deployment: its saved observation block is no longer canonical")
  }
  const path = resolve(requiredEnv(env, "CONTRACT_RELEASE_BROADCAST_DIR"), "DeployContracts.s.sol", String(plan.expectedChainId), "run-latest.json")
  const broadcast = parseJsonRecord(await readBoundedRegularFile(path, "business Forge broadcast", 16 * 1024 * 1024), "business Forge broadcast")
  if (!Array.isArray(broadcast.transactions) || broadcast.transactions.length !== reference.steps.length) {
    throw new Error("Cannot collect business deployment: its mined transaction count differs from the approved operation")
  }
  const verifier = new ReleaseVerifier(reference, async hash => {
    const receipt = await client.getTransactionReceipt({ hash })
    return { transactionHash: receipt.transactionHash, status: receipt.status === "success" ? "0x1" : "0x0", contractAddress: receipt.contractAddress ?? null }
  })
  const contracts: Record<string, ContractIdentity> = {}
  const initializationTransactions: Hex[] = []
  for (const transaction of broadcast.transactions) {
    const hash = requiredTransactionHash(requiredJsonRecord(transaction, "business broadcast transaction").hash, "business transaction hash")
    const [mined, receipt] = await Promise.all([client.getTransaction({ hash }), client.getTransactionReceipt({ hash })])
    if (receipt.blockNumber > blockNumber) {
      throw new Error(`Cannot collect business transaction ${hash}: receipt block ${receipt.blockNumber} is later than observation block ${blockNumber}`)
    }
    if (mined.type !== "eip1559") throw new Error(`Cannot collect business transaction ${hash}: the release requires signed type-2 transactions`)
    const raw = serializeTransaction({ ...mined, data: mined.input }, { r: mined.r, s: mined.s, yParity: mined.yParity })
    const review = await verifier.inspect(raw)
    if (review.signed.hash !== hash || receipt.transactionHash !== hash || receipt.status !== "success"
        || getAddress(receipt.from) !== getAddress(reference.expectedDeployer)
        || (await client.getBlock({ blockNumber: receipt.blockNumber })).hash !== receipt.blockHash) {
      throw new Error(`Cannot collect business transaction ${hash}: its signed bytes or canonical successful receipt differ`)
    }
    verifier.accepted(hash)
    if (review.step.kind === "create") {
      if (receipt.contractAddress === null || receipt.contractAddress === undefined
          || getAddress(receipt.contractAddress) !== getAddress(review.comparison.predictedAddress!)) {
        throw new Error(`Cannot collect ${review.step.role}: its creation receipt names a different contract`)
      }
      const address = getAddress(receipt.contractAddress)
      const code = await client.getCode({ address, blockNumber })
      if (code === undefined || code === "0x") throw new Error(`Cannot collect ${review.step.role} at ${address}: no runtime exists at the observation block`)
      contracts[review.step.role] = { address, creationTransaction: hash, creationInputHash: keccak256(mined.input), codeHash: keccak256(code) }
    } else initializationTransactions.push(hash)
  }
  const administration = plan.app === "escrow" ? {} : plan.app === "pay-to-play" ? { payments: {
    owner: getAddress(await client.readContract({ address: contracts.payments!.address, abi: OWNABLE, functionName: "owner", blockNumber })),
    pendingOwner: getAddress(await client.readContract({ address: contracts.payments!.address, abi: OWNABLE, functionName: "pendingOwner", blockNumber })),
  } } : { components: await delayed(contracts.components!), manager: await delayed(contracts.manager!) }
  if ((await client.getBlock({ blockNumber })).hash !== observation.hash) {
    throw new Error("Cannot collect business deployment: its observation block changed while reading receipts, code or administration")
  }
  const candidate = parseContractDeployment(new TextEncoder().encode(JSON.stringify({ schema: "cam.contract-deployment.v1",
    app: plan.app, sourceCommit: plan.sourceCommit, chainId: plan.expectedChainId, creator: getAddress(reference.expectedDeployer),
    planSha256: reference.planSha256, contracts, initializationTransactions, administration,
    verificationBlock: { number: toHex(blockNumber), hash: observation.hash },
  })), plan.app)
  await writeNewJson(candidatePath, candidate, "business deployment candidate")
  process.stdout.write(`${JSON.stringify({ event: "contract_deployment_observed", app: plan.app, sourceCommit: plan.sourceCommit, contracts, administration, verificationBlock: candidate.verificationBlock })}\n`)

  async function delayed(contract: ContractIdentity): Promise<DelayedAdministration> {
    const [admin, pending] = await Promise.all([
      client.readContract({ address: contract.address, abi: DELAYED_ADMIN, functionName: "defaultAdmin", blockNumber }),
      client.readContract({ address: contract.address, abi: DELAYED_ADMIN, functionName: "pendingDefaultAdmin", blockNumber }),
    ])
    return { admin: getAddress(admin), pendingAdmin: getAddress(pending[0]), pendingSchedule: pending[1] }
  }
}

runReleaseTool(main)
