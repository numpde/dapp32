import { keccak256, type Address, type Hex } from "viem"

import {
  requiredNonzeroAddress, requiredNonzeroBytes32, requiredJsonRecord, requireExactKeys,
  requiredTransactionHash,
} from "./release-values.ts"

export type ContractIdentity = {
  readonly address: Address
  readonly codeHash: Hex
  readonly creationTransaction: Hex
  readonly creationInputHash: Hex
}

export function parseContractIdentity(value: unknown, label: string): ContractIdentity {
  const identity = requiredJsonRecord(value, label)
  requireExactKeys(identity, ["address", "codeHash", "creationTransaction", "creationInputHash"], label)
  return {
    address: requiredNonzeroAddress(identity.address, `${label} address`),
    codeHash: requiredNonzeroBytes32(identity.codeHash, `${label} runtime hash`),
    creationTransaction: requiredTransactionHash(identity.creationTransaction, `${label} creation transaction`),
    creationInputHash: requiredNonzeroBytes32(identity.creationInputHash, `${label} creation input hash`),
  }
}

export type ContractIdentityReference = Omit<ContractIdentity, "creationInputHash"> & { readonly creationInputHash?: Hex }
export type ContractIdentityReader = {
  getBlock(request: { blockNumber: bigint }): Promise<{ hash: Hex | null }>
  getCode(request: { address: Address; blockNumber: bigint }): Promise<Hex | undefined>
  getTransactionReceipt(request: { hash: Hex }): Promise<CreationReceiptEvidence & { blockNumber: bigint; blockHash: Hex }>
  getTransaction(request: { hash: Hex }): Promise<{ hash: Hex; from: Address; to: Address | null; input: Hex }>
}

export async function observeContractIdentity(client: ContractIdentityReader, expected: ContractIdentityReference,
  creator: Address, blockNumber: bigint, label: string): Promise<{ identity: ContractIdentity; creationInput: Hex }> {
  const [receipt, transaction, code] = await Promise.all([
    client.getTransactionReceipt({ hash: expected.creationTransaction }),
    client.getTransaction({ hash: expected.creationTransaction }),
    client.getCode({ address: expected.address, blockNumber }),
  ])
  const creation = { address: expected.address, transactionHash: expected.creationTransaction }
  const target = `${label} ${expected.address}`
  const actualCreator = creationReceiptDeployer(creation, receipt, target)
  if (actualCreator.toLowerCase() !== creator.toLowerCase()) throw new Error(`Cannot verify ${target}: creation sender ${actualCreator} differs from recorded creator ${creator}`)
  const creationInputHash = creationTransactionInputHash(creation, transaction, creator, target)
  if (expected.creationInputHash !== undefined && expected.creationInputHash.toLowerCase() !== creationInputHash.toLowerCase()) {
    throw new Error(`Cannot verify ${target}: creation input hash ${creationInputHash} differs from recorded hash ${expected.creationInputHash}`)
  }
  if (receipt.blockNumber > blockNumber) throw new Error(`Cannot verify ${target}: creation receipt block ${receipt.blockNumber} is later than observation block ${blockNumber}`)
  const creationBlock = await client.getBlock({ blockNumber: receipt.blockNumber })
  if (creationBlock.hash !== receipt.blockHash) {
    throw new Error(`Cannot verify ${target}: creation receipt block ${receipt.blockHash} differs from canonical block ${creationBlock.hash}`)
  }
  if (code === undefined || code === "0x") throw new Error(`Cannot verify ${target}: no runtime exists at observation block ${blockNumber}`)
  const codeHash = keccak256(code)
  if (codeHash.toLowerCase() !== expected.codeHash.toLowerCase()) throw new Error(`Cannot verify ${target}: runtime hash ${codeHash} differs from recorded hash ${expected.codeHash}`)
  return { identity: { address: expected.address, creationTransaction: expected.creationTransaction, creationInputHash, codeHash },
    creationInput: transaction.input }
}

export type CreatedContract = { readonly address: Address; readonly transactionHash: Hex }
export type CreationReceiptEvidence = {
  readonly status: "success" | "reverted"
  readonly contractAddress: Address | null | undefined
  readonly transactionHash: Hex
  readonly from: Address
  readonly to: Address | null
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

function isCreateTransaction(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) && (value as Record<string, unknown>).transactionType === "CREATE"
}
