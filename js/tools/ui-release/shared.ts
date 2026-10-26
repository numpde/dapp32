import { createHash } from "node:crypto"
import { getAddress, keccak256, type Address, type Hex } from "viem"
import { bikeUICreation } from "../bike-nft-release/reference.ts"
import { escrowUICreation } from "../escrow-release/reference.ts"
import { payToPlayUICreation } from "../pay-to-play-release/reference.ts"
import { parseDeploymentArtifact as parseBikeDeployment } from "../bike-nft-release/shared.ts"
import { parseDeploymentArtifact as parseEscrowDeployment } from "../escrow-release/shared.ts"
import { parseDeploymentArtifact as parsePaymentDeployment } from "../pay-to-play-release/shared.ts"
import { creationReceiptDeployer, creationTransactionInputHash, type CreationReceiptEvidence } from "../release-provenance.ts"
import { expectedDeployer, type ReleaseReference } from "../release-approval/reference.ts"
import type { ReleaseApp } from "../release-approval/reference-read.ts"
import { parseContractDeployment } from "../contract-release/shared.ts"
import {
  checkedReleaseChainId, parseJsonRecord, requireExactKeys, requiredBytes32, requiredJsonRecord,
  requiredNonzeroAddress, requiredNonzeroBytes32, requiredSafeInteger, requiredSourceCommit,
  requiredTransactionHash,
} from "../release-values.ts"

export type UIBackingReference = {
  readonly sourceCommit: string
  readonly chainId: number
  readonly creator: Address
  readonly artifactSha256: Hex
  readonly address: Address
  readonly codeHash: Hex
  readonly creationTransaction: Hex
  readonly creationInputHash?: Hex
}

export type UIReleasePlan = {
  readonly schema: "cam.ui-release-plan.v1"
  readonly app: ReleaseApp
  readonly sourceCommit: string
  readonly expectedChainId: number
  readonly backing: UIBackingReference
}

export type UIDeploymentReference = ReleaseReference & { readonly backing: UIBackingReference }

export const UI_SCRIPT_NAME = "DeployUI.s.sol"

export function parseUIReleasePlan(bytes: Uint8Array): UIReleasePlan {
  const value = parseJsonRecord(bytes, "UI release plan")
  requireExactKeys(value, ["schema", "app", "sourceCommit", "expectedChainId", "backing"], "UI release plan")
  if (value.schema !== "cam.ui-release-plan.v1" || (value.app !== "bike-nft" && value.app !== "escrow" && value.app !== "pay-to-play")) {
    throw new Error("Cannot prepare UI deployment: the plan must identify a maintained app and the UI plan format")
  }
  const backing = requiredJsonRecord(value.backing, "UI backing deployment")
  requireExactKeys(backing, ["sourceCommit", "chainId", "creator", "artifactSha256", "address", "codeHash", "creationTransaction", "creationInputHash"], "UI backing deployment")
  const plan: UIReleasePlan = {
    schema: "cam.ui-release-plan.v1", app: value.app,
    sourceCommit: requiredSourceCommit(value.sourceCommit),
    expectedChainId: checkedReleaseChainId(requiredSafeInteger(value.expectedChainId, "UI chain ID")),
    backing: {
      sourceCommit: requiredSourceCommit(backing.sourceCommit),
      chainId: checkedReleaseChainId(requiredSafeInteger(backing.chainId, "backing chain ID")),
      creator: requiredNonzeroAddress(backing.creator, "backing creator"),
      artifactSha256: requiredBytes32(backing.artifactSha256, "backing artifact SHA-256"),
      address: requiredNonzeroAddress(backing.address, "backing contract"),
      codeHash: requiredNonzeroBytes32(backing.codeHash, "backing runtime hash"),
      creationTransaction: requiredTransactionHash(backing.creationTransaction, "backing creation transaction"),
      creationInputHash: requiredNonzeroBytes32(backing.creationInputHash, "backing creation input hash"),
    },
  }
  requireUIChain(plan)
  return plan
}

function requireUIChain(plan: UIReleasePlan): void {
  if (plan.expectedChainId !== plan.backing.chainId) throw new Error("Cannot deploy UI: its selected chain differs from the backing deployment")
}

export function backingFromDeployment(app: ReleaseApp, bytes: Uint8Array): UIBackingReference {
  const artifactSha256 = `0x${createHash("sha256").update(bytes).digest("hex")}` as Hex
  if (parseJsonRecord(bytes, "backing deployment artifact").schema === "cam.contract-deployment.v1") {
    const deployment = parseContractDeployment(bytes, app)
    const role = app === "bike-nft" ? "manager" : app === "escrow" ? "escrow" : "payments"
    const contract = deployment.contracts[role]!
    return { sourceCommit: deployment.sourceCommit, chainId: deployment.chainId, creator: deployment.creator,
      artifactSha256, ...contract }
  }
  if (app === "bike-nft") {
    const deployment = parseBikeDeployment(bytes)
    return { sourceCommit: deployment.sourceCommit, chainId: deployment.chainId, creator: deployment.deployer,
      artifactSha256, address: deployment.manager, codeHash: deployment.managerCodeHash,
      creationTransaction: deployment.managerCreationTransaction }
  }
  if (app === "escrow") {
    const deployment = parseEscrowDeployment(bytes)
    return { sourceCommit: deployment.sourceCommit, chainId: deployment.chainId, creator: deployment.deployer,
      artifactSha256, address: deployment.camEscrow, codeHash: deployment.camEscrowCodeHash,
      creationTransaction: deployment.camEscrowCreationTransaction }
  }
  const deployment = parsePaymentDeployment(bytes)
  return { sourceCommit: deployment.sourceCommit, chainId: deployment.chainId, creator: deployment.deployer,
    artifactSha256, address: deployment.payToPlay, codeHash: deployment.payToPlayCodeHash,
    creationTransaction: deployment.payToPlayCreationTransaction, creationInputHash: deployment.payToPlayCreationInputHash }
}

export function uiDeploymentReference(plan: UIReleasePlan, independentCreator: string): UIDeploymentReference {
  requireUIChain(plan)
  const create = plan.app === "bike-nft" ? bikeUICreation : plan.app === "escrow" ? escrowUICreation : payToPlayUICreation
  return { sourceCommit: plan.sourceCommit, expectedChainId: plan.expectedChainId,
    expectedDeployer: expectedDeployer(independentCreator), backing: plan.backing, steps: [create(plan.backing.address)] }
}

type BackingReader = {
  getChainId(): Promise<number>
  getBlockNumber(): Promise<bigint>
  getBlock(request: { blockNumber: bigint }): Promise<{ hash: Hex | null }>
  getCode(request: { address: Address; blockNumber: bigint }): Promise<Hex | undefined>
  getTransactionReceipt(request: { hash: Hex }): Promise<CreationReceiptEvidence & { blockNumber: bigint; blockHash: Hex }>
  getTransaction(request: { hash: Hex }): Promise<{ hash: Hex; from: Address; to: Address | null; input: Hex }>
}

export async function verifyUIBacking(client: BackingReader, backing: UIBackingReference): Promise<{
  creationInputHash: Hex; blockNumber: string; blockHash: Hex
}> {
  const chainId = await client.getChainId()
  if (chainId !== backing.chainId) throw new Error(`Cannot verify UI backing ${backing.address}: RPC chain ${chainId} differs from backing chain ${backing.chainId}`)
  const [receipt, transaction, blockNumber] = await Promise.all([
    client.getTransactionReceipt({ hash: backing.creationTransaction }),
    client.getTransaction({ hash: backing.creationTransaction }),
    client.getBlockNumber(),
  ])
  const creation = { address: backing.address, transactionHash: backing.creationTransaction }
  const creator = creationReceiptDeployer(creation, receipt, "UI backing")
  if (getAddress(creator) !== getAddress(backing.creator)) throw new Error(`Cannot verify UI backing ${backing.address}: creation sender ${creator} differs from recorded creator ${backing.creator}`)
  const creationInputHash = creationTransactionInputHash(creation, transaction, creator, "UI backing")
  if (backing.creationInputHash !== undefined && creationInputHash.toLowerCase() !== backing.creationInputHash.toLowerCase()) {
    throw new Error(`Cannot verify UI backing ${backing.address}: creation input hash ${creationInputHash} differs from recorded hash ${backing.creationInputHash}`)
  }
  const observedBlock = await client.getBlock({ blockNumber })
  const [code, creationBlock] = await Promise.all([
    client.getCode({ address: backing.address, blockNumber }),
    client.getBlock({ blockNumber: receipt.blockNumber }),
  ])
  if (creationBlock.hash !== receipt.blockHash) throw new Error(`Cannot verify UI backing ${backing.address}: creation receipt block ${receipt.blockHash} differs from canonical block ${creationBlock.hash}`)
  if (code === undefined || code === "0x") {
    throw new Error(`Cannot verify UI backing ${backing.address}: no runtime code at block ${blockNumber}`)
  }
  const codeHash = keccak256(code)
  if (codeHash.toLowerCase() !== backing.codeHash.toLowerCase()) {
    throw new Error(`Cannot verify UI backing ${backing.address}: runtime hash ${codeHash} differs from recorded hash ${backing.codeHash}`)
  }
  if (observedBlock.hash === null || (await client.getBlock({ blockNumber })).hash !== observedBlock.hash) {
    throw new Error(`Cannot verify UI backing ${backing.address}: observation block ${blockNumber} changed during verification`)
  }
  return { creationInputHash, blockNumber: blockNumber.toString(), blockHash: observedBlock.hash }
}
