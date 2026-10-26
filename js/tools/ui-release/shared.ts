import type { Address, Hex } from "viem"
import { bikeUICreation } from "../bike-nft-release/reference.ts"
import { escrowUICreation } from "../escrow-release/reference.ts"
import { payToPlayUICreation } from "../pay-to-play-release/reference.ts"
import { observeContractIdentity, parseContractIdentity, type ContractIdentity, type ContractIdentityReference, type ContractIdentityReader } from "../release-provenance.ts"
import { expectedDeployer, type ReleaseReference, type ExpectedArgument, type ExpectedStep } from "../release-approval/reference.ts"
import type { ReleaseApp } from "../release-approval/reference-read.ts"
import { businessFromDeployment } from "../contract-release/shared.ts"
import {
  checkedReleaseChainId, parseJsonRecord, requireExactKeys, requiredBytes32, requiredJsonRecord,
  requiredNonzeroAddress, requiredNonzeroBytes32, requiredSafeInteger, requiredSourceCommit,
} from "../release-values.ts"

export type UIBackingReference = ContractIdentityReference & {
  readonly sourceCommit: string
  readonly chainId: number
  readonly creator: Address
  readonly artifactSha256: Hex
}

export type UIReleasePlan = {
  readonly schema: "cam.ui-release-plan.v1"
  readonly app: ReleaseApp
  readonly sourceCommit: string
  readonly expectedChainId: number
  readonly backing: UIBackingReference & { readonly creationInputHash: Hex }
}

export type UIDeploymentReference = ReleaseReference & { readonly backing: UIBackingReference }

export const UI_SCRIPT_NAME = "DeployUI.s.sol"

export function parseUIReleasePlan(bytes: Uint8Array): UIReleasePlan {
  const value = parseJsonRecord(bytes, "UI release plan")
  requireExactKeys(value, ["schema", "app", "sourceCommit", "expectedChainId", "backing"], "UI release plan")
  if (value.schema !== "cam.ui-release-plan.v1" || (value.app !== "bike-nft" && value.app !== "escrow" && value.app !== "pay-to-play")) {
    throw new Error("Cannot prepare UI deployment: the plan must identify a maintained app and the UI plan format")
  }
  const plan: UIReleasePlan = {
    schema: "cam.ui-release-plan.v1", app: value.app,
    sourceCommit: requiredSourceCommit(value.sourceCommit),
    expectedChainId: checkedReleaseChainId(requiredSafeInteger(value.expectedChainId, "UI chain ID")),
    backing: parseUIBacking(value.backing),
  }
  requireUIChain(plan)
  return plan
}

function requireUIChain(plan: UIReleasePlan): void {
  if (plan.expectedChainId !== plan.backing.chainId) throw new Error("Cannot deploy UI: its selected chain differs from the backing deployment")
}

export function backingFromDeployment(app: ReleaseApp, bytes: Uint8Array): UIBackingReference {
  const deployment = businessFromDeployment(app, bytes)
  const role = app === "bike-nft" ? "manager" : app === "escrow" ? "escrow" : "payments"
  return { sourceCommit: deployment.sourceCommit, chainId: deployment.chainId, creator: deployment.creator,
    artifactSha256: deployment.artifactSha256, ...deployment.contracts[role]! }
}

export function uiDeploymentReference(plan: UIReleasePlan, independentCreator: string): UIDeploymentReference {
  requireUIChain(plan)
  return { sourceCommit: plan.sourceCommit, expectedChainId: plan.expectedChainId,
    expectedDeployer: expectedDeployer(independentCreator), backing: plan.backing, steps: [uiCreationStep(plan.app, plan.backing.address)] }
}

export function uiCreationStep(app: ReleaseApp, backing: ExpectedArgument): ExpectedStep {
  const create = app === "bike-nft" ? bikeUICreation : app === "escrow" ? escrowUICreation : payToPlayUICreation
  return create(backing)
}

type BackingReader = ContractIdentityReader & { getChainId(): Promise<number>; getBlockNumber(): Promise<bigint> }

export async function verifyUIBacking(client: BackingReader, backing: UIBackingReference): Promise<{
  creationInputHash: Hex; blockNumber: string; blockHash: Hex
}> {
  const chainId = await client.getChainId()
  if (chainId !== backing.chainId) throw new Error(`Cannot verify UI backing ${backing.address}: RPC chain ${chainId} differs from backing chain ${backing.chainId}`)
  const blockNumber = await client.getBlockNumber()
  const observedBlock = await client.getBlock({ blockNumber })
  const observed = await observeContractIdentity(client, backing, backing.creator, blockNumber, "UI backing")
  if (observedBlock.hash === null || (await client.getBlock({ blockNumber })).hash !== observedBlock.hash) {
    throw new Error(`Cannot verify UI backing ${backing.address}: observation block ${blockNumber} changed during verification`)
  }
  return { creationInputHash: observed.identity.creationInputHash, blockNumber: blockNumber.toString(), blockHash: observedBlock.hash }
}

function parseUIBacking(raw: unknown): UIReleasePlan["backing"] {
  const backing = requiredJsonRecord(raw, "UI backing deployment")
  requireExactKeys(backing, ["sourceCommit", "chainId", "creator", "artifactSha256", "address", "codeHash", "creationTransaction", "creationInputHash"], "UI backing deployment")
  const { sourceCommit, chainId, creator, artifactSha256, ...identity } = backing
  return {
    sourceCommit: requiredSourceCommit(sourceCommit),
    chainId: checkedReleaseChainId(requiredSafeInteger(chainId, "backing chain ID")),
    creator: requiredNonzeroAddress(creator, "backing creator"),
    artifactSha256: requiredBytes32(artifactSha256, "backing artifact SHA-256"),
    ...parseContractIdentity(identity, "UI backing"),
  }
}

export type UIDeploymentArtifact = {
  readonly schema: "cam.ui-deployment.v1"
  readonly app: ReleaseApp
  readonly sourceCommit: string
  readonly chainId: number
  readonly creator: Address
  readonly planSha256: Hex
  readonly referenceSha256: Hex
  readonly backing: UIReleasePlan["backing"]
  readonly ui: ContractIdentity
  readonly verificationBlock: { readonly number: Hex; readonly hash: Hex }
}

export function parseUIDeploymentArtifact(bytes: Uint8Array, app: ReleaseApp): UIDeploymentArtifact {
  const value = parseJsonRecord(bytes, "UI deployment artifact")
  requireExactKeys(value, ["schema", "app", "sourceCommit", "chainId", "creator", "planSha256", "referenceSha256", "backing", "ui", "verificationBlock"], "UI deployment artifact")
  if (value.schema !== "cam.ui-deployment.v1" || value.app !== app) throw new Error(`Cannot read ${app} UI deployment: its artifact schema or app differs`)
  const chainId = checkedReleaseChainId(requiredSafeInteger(value.chainId, "UI artifact chain ID"))
  const backing = parseUIBacking(value.backing)
  if (chainId !== backing.chainId) throw new Error("Cannot read UI deployment: its chain differs from the recorded backing chain")
  const block = requiredJsonRecord(value.verificationBlock, "UI verification block")
  requireExactKeys(block, ["number", "hash"], "UI verification block")
  if (typeof block.number !== "string" || !/^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/.test(block.number)) {
    throw new Error("Cannot read UI deployment: its verification block number must be a hex quantity")
  }
  return { schema: "cam.ui-deployment.v1", app, chainId, sourceCommit: requiredSourceCommit(value.sourceCommit),
    creator: requiredNonzeroAddress(value.creator, "UI creator"), planSha256: requiredBytes32(value.planSha256, "UI plan SHA-256"),
    referenceSha256: requiredBytes32(value.referenceSha256, "UI reference SHA-256"), backing,
    ui: parseContractIdentity(value.ui, "UI identity"),
    verificationBlock: { number: block.number as Hex, hash: requiredNonzeroBytes32(block.hash, "UI verification block hash") },
  }
}
