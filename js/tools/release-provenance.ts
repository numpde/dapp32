import type { Address, Hex } from "viem"

import {
  requiredNonzeroAddress,
  requiredTransactionHash,
} from "./release-values.ts"

export type CreatedContract = { readonly address: Address; readonly transactionHash: Hex }
export type CreationReceiptEvidence = {
  readonly status: "success" | "reverted"
  readonly contractAddress: Address | null | undefined
  readonly transactionHash: Hex
  readonly from: Address
  readonly to: Address | null
}

export function createdContract(transactions: readonly unknown[], contractName: string): CreatedContract {
  const matches = transactions.filter(isCreateTransaction).filter((value) => value.contractName === contractName)
  if (matches.length !== 1) throw new Error(`Forge broadcast must create ${contractName} exactly once`)
  const value = matches[0]!
  const address = requiredNonzeroAddress(value.contractAddress, `${contractName} contractAddress`)
  const transactionHash = requiredTransactionHash(value.hash, `${contractName} transaction hash`)
  return { address, transactionHash }
}

export function creationReceiptDeployer(contract: CreatedContract, receipt: CreationReceiptEvidence, label: string): Address {
  if (receipt.status !== "success") throw new Error(`${label} creation transaction did not succeed: ${receipt.transactionHash}`)
  if (receipt.transactionHash.toLowerCase() !== contract.transactionHash.toLowerCase()) throw new Error(`${label} receipt transaction hash does not match Forge broadcast`)
  if (receipt.to !== null) throw new Error(`${label} creation receipt unexpectedly has a destination address`)
  if (receipt.contractAddress === null || receipt.contractAddress === undefined) throw new Error(`${label} creation receipt has no contract address`)
  const actual = requiredNonzeroAddress(receipt.contractAddress, `${label} creation receipt address`)
  if (actual.toLowerCase() !== contract.address.toLowerCase()) throw new Error(`${label} creation receipt address mismatch: expected ${contract.address}, got ${actual}`)
  return requiredNonzeroAddress(receipt.from, `${label} creation receipt deployer`)
}

function isCreateTransaction(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) && (value as Record<string, unknown>).transactionType === "CREATE"
}
