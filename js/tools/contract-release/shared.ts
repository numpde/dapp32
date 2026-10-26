import type { Address, Hex } from "viem"
import { ARTIFACTS, type ReleaseApp } from "../release-approval/reference-read.ts"
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

export function businessContractRoles(app: ReleaseApp): readonly string[] {
  return Object.keys(ARTIFACTS[app]).filter(role => role !== "camRoot" && role !== "ui")
}

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
