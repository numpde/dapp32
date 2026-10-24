import { keccak256, type Address, type Hex } from "viem"

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

type LabeledCreation = CreatedContract & { readonly label: string }
type CreationReader = {
  getChainId(): Promise<number>
  getTransactionReceipt(request: { readonly hash: Hex }): Promise<CreationReceiptEvidence>
}

export async function observeReleaseCreations({ client, expectedChainId, contracts }: {
  readonly client: CreationReader
  readonly expectedChainId: number
  readonly contracts: readonly [LabeledCreation, ...LabeledCreation[]]
}): Promise<{ readonly chainId: number; readonly deployer: Address }> {
  const chainId = await client.getChainId()
  if (chainId !== expectedChainId) {
    throw new Error(`release RPC chain mismatch: expected ${expectedChainId}, got ${chainId}`)
  }
  const receipts = await Promise.all(contracts.map(contract => client.getTransactionReceipt({ hash: contract.transactionHash })))
  const deployers: [Address, ...Address[]] = [
    creationReceiptDeployer(contracts[0], receipts[0]!, contracts[0].label),
    ...contracts.slice(1).map((contract, index) => creationReceiptDeployer(contract, receipts[index + 1]!, contract.label)),
  ]
  return { chainId, deployer: sharedCreationReceiptDeployer(deployers) }
}

export function creationTransactionInputHash(
  contract: CreatedContract,
  transaction: { readonly hash: Hex; readonly from: Address; readonly to: Address | null; readonly input: Hex },
  deployer: Address,
  label: string,
): Hex {
  if (transaction.hash.toLowerCase() !== contract.transactionHash.toLowerCase()) throw new Error(`${label} creation transaction hash mismatch`)
  if (transaction.from.toLowerCase() !== deployer.toLowerCase()) throw new Error(`${label} creation transaction sender mismatch`)
  if (transaction.to !== null) throw new Error(`${label} creation transaction has a destination address`)
  if (!/^0x(?:[0-9a-fA-F]{2})+$/.test(transaction.input)) throw new Error(`${label} creation transaction has no valid input bytes`)
  return keccak256(transaction.input)
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

export function sharedCreationReceiptDeployer(
  deployers: readonly [Address, ...Address[]],
): Address {
  if (new Set(deployers.map((deployer) => deployer.toLowerCase())).size !== 1) {
    throw new Error("release creation transactions do not share one deployer")
  }
  return deployers[0]
}

function isCreateTransaction(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) && (value as Record<string, unknown>).transactionType === "CREATE"
}
