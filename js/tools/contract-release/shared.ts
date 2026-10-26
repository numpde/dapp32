import { parseContractSettings as parseBikeContractSettings, type ContractSettings as BikeContractSettings } from "../bike-nft-release/shared.ts"
import { parseContractSettings as parsePaymentContractSettings, type ContractSettings as PaymentContractSettings } from "../pay-to-play-release/shared.ts"
import type { Address, Hex } from "viem"
import { businessContractRoles, type ReleaseApp } from "../release-approval/reference-read.ts"
import {
  checkedReleaseChainId, parseJsonRecord, requireDistinctHexValues, requireExactKeys,
  requiredBytes32, requiredJsonRecord, requiredNonzeroAddress, requiredNonzeroBytes32,
  requiredSafeInteger, requiredSourceCommit, requiredTransactionHash,
} from "../release-values.ts"

export type ContractIdentity = {
  readonly address: Address
  readonly codeHash: Hex
  readonly creationTransaction: Hex
  readonly creationInputHash: Hex
}

export type ContractDeploymentArtifact = {
  readonly schema: "cam.contract-deployment.v1"
  readonly app: ReleaseApp
  readonly sourceCommit: string
  readonly chainId: number
  readonly creator: Address
  readonly planSha256: Hex
  readonly contracts: Readonly<Record<string, ContractIdentity>>
  readonly initializationTransactions: readonly Hex[]
}

export { businessContractRoles } from "../release-approval/reference-read.ts"

export function parseContractDeployment(bytes: Uint8Array, app: ReleaseApp): ContractDeploymentArtifact {
  const value = parseJsonRecord(bytes, "business deployment artifact")
  requireExactKeys(value, ["schema", "app", "sourceCommit", "chainId", "creator", "planSha256", "contracts", "initializationTransactions"], "business deployment artifact")
  if (value.schema !== "cam.contract-deployment.v1" || value.app !== app) {
    throw new Error(`Cannot read ${app} business deployment: its artifact schema or app differs`)
  }
  const identities = requiredJsonRecord(value.contracts, "business contract inventory")
  requireExactKeys(identities, businessContractRoles(app), "business contract inventory")
  const contracts: Record<string, ContractIdentity> = {}
  for (const [role, identity] of Object.entries(identities)) {
    const contract = requiredJsonRecord(identity, `${role} contract identity`)
    requireExactKeys(contract, ["address", "codeHash", "creationTransaction", "creationInputHash"], `${role} contract identity`)
    contracts[role] = {
      address: requiredNonzeroAddress(contract.address, `${role} address`),
      codeHash: requiredNonzeroBytes32(contract.codeHash, `${role} runtime hash`),
      creationTransaction: requiredTransactionHash(contract.creationTransaction, `${role} creation transaction`),
      creationInputHash: requiredNonzeroBytes32(contract.creationInputHash, `${role} creation input hash`),
    }
  }
  requireDistinctHexValues(Object.values(contracts).map(contract => contract.address), "business contract addresses")
  requireDistinctHexValues(Object.values(contracts).map(contract => contract.creationTransaction), "business creation transactions")
  if (!Array.isArray(value.initializationTransactions)) throw new Error("Business initialization transactions must be an array")
  return {
    schema: "cam.contract-deployment.v1", app, sourceCommit: requiredSourceCommit(value.sourceCommit),
    chainId: checkedReleaseChainId(requiredSafeInteger(value.chainId, "business deployment chain ID")),
    creator: requiredNonzeroAddress(value.creator, "business creator"),
    planSha256: requiredBytes32(value.planSha256, "business plan SHA-256"), contracts,
    initializationTransactions: value.initializationTransactions.map(hash => requiredTransactionHash(hash, "business initialization transaction")),
  }
}

export type ContractReleasePlan = {
  readonly schema: "cam.contract-release-plan.v1"
  readonly sourceCommit: string
  readonly expectedChainId: number
} & (
  | { readonly app: "bike-nft"; readonly settings: BikeContractSettings }
  | { readonly app: "pay-to-play"; readonly settings: PaymentContractSettings }
  | { readonly app: "escrow"; readonly settings: Readonly<Record<string, never>> }
)

export function parseContractReleasePlan(bytes: Uint8Array): ContractReleasePlan {
  const value = parseJsonRecord(bytes, "business release plan")
  requireExactKeys(value, ["schema", "app", "sourceCommit", "expectedChainId", "settings"], "business release plan")
  if (value.schema !== "cam.contract-release-plan.v1") throw new Error("Unsupported business release plan schema")
  const identity = {
    schema: "cam.contract-release-plan.v1" as const,
    sourceCommit: requiredSourceCommit(value.sourceCommit),
    expectedChainId: checkedReleaseChainId(requiredSafeInteger(value.expectedChainId, "business chain ID")),
  }
  const settings = requiredJsonRecord(value.settings, "business contract settings")
  if (value.app === "bike-nft") {
    const parsed = parseBikeContractSettings(settings)
    requireExactKeys(settings, Object.keys(parsed), "Bike contract settings")
    return { ...identity, app: value.app, settings: parsed }
  }
  if (value.app === "pay-to-play") {
    const parsed = parsePaymentContractSettings(settings)
    requireExactKeys(settings, Object.keys(parsed), "PayToPlay contract settings")
    return { ...identity, app: value.app, settings: parsed }
  }
  if (value.app !== "escrow") throw new Error("Business release plan must select bike-nft, escrow or pay-to-play")
  requireExactKeys(settings, [], "Escrow contract settings")
  return { ...identity, app: value.app, settings: {} }
}
