import { getAddress } from "viem"
import type { Address, Hex } from "viem"

import {
  ZERO_ADDRESS,
  requiredNonzeroAddress,
  requiredRecord,
  requiredString,
  requiredTransactionHash,
} from "./shared.ts"

export type CreatedContract = {
  readonly address: Address
  readonly transactionHash: Hex
}

export type DeploymentContracts = {
  readonly camRoot: CreatedContract
  readonly camEscrow: CreatedContract
  readonly camEscrowUI: CreatedContract
}

export type OwnershipState = {
  readonly ownershipTransferRequired: boolean
  readonly ownershipAccepted: boolean
}

export type CreationReceiptEvidence = {
  readonly status: "success" | "reverted"
  readonly contractAddress: Address | null
  readonly transactionHash: Hex
  readonly from: Address
  readonly to: Address | null
}

export function deploymentContractsFromBroadcast(broadcast: unknown): DeploymentContracts {
  const root = requiredRecord(broadcast, "Forge broadcast")
  if (!Array.isArray(root.transactions)) {
    throw new Error("Forge broadcast must contain a transactions array")
  }

  return {
    camRoot: createdContract(root.transactions, "CamRoot"),
    camEscrow: createdContract(root.transactions, "CamEscrow"),
    camEscrowUI: createdContract(root.transactions, "CamEscrowUI"),
  }
}

export function creationReceiptDeployer(
  contract: CreatedContract,
  receipt: CreationReceiptEvidence,
  label: string,
): Address {
  if (receipt.status !== "success") {
    throw new Error(`${label} creation transaction did not succeed: ${receipt.transactionHash}`)
  }
  if (receipt.transactionHash.toLowerCase() !== contract.transactionHash.toLowerCase()) {
    throw new Error(`${label} receipt transaction hash does not match Forge broadcast`)
  }
  if (receipt.to !== null) {
    throw new Error(`${label} creation receipt unexpectedly has a destination address`)
  }
  if (receipt.contractAddress === null) {
    throw new Error(`${label} creation receipt has no contract address`)
  }
  const actualAddress = getAddress(receipt.contractAddress)
  if (actualAddress.toLowerCase() !== contract.address.toLowerCase()) {
    throw new Error(
      `${label} creation receipt address mismatch: expected ${contract.address}, got ${actualAddress}`,
    )
  }
  return getAddress(receipt.from)
}

export function ownershipState({
  deployer,
  intendedOwner,
  owner,
  pendingOwner,
}: {
  readonly deployer: Address
  readonly intendedOwner: Address
  readonly owner: Address
  readonly pendingOwner: Address
}): OwnershipState {
  const normalizedDeployer = deployer.toLowerCase()
  const normalizedIntendedOwner = intendedOwner.toLowerCase()
  const normalizedOwner = owner.toLowerCase()
  const normalizedPendingOwner = pendingOwner.toLowerCase()
  const zero = ZERO_ADDRESS.toLowerCase()

  if (normalizedOwner === normalizedIntendedOwner && normalizedPendingOwner === zero) {
    return {
      ownershipTransferRequired: normalizedDeployer !== normalizedIntendedOwner,
      ownershipAccepted: true,
    }
  }
  if (
    normalizedOwner === normalizedDeployer
    && normalizedPendingOwner === normalizedIntendedOwner
    && normalizedDeployer !== normalizedIntendedOwner
  ) {
    return {
      ownershipTransferRequired: true,
      ownershipAccepted: false,
    }
  }

  throw new Error(
    `unexpected CamRoot ownership state: deployer=${deployer} intended=${intendedOwner} owner=${owner} pending=${pendingOwner}`,
  )
}

function createdContract(transactions: readonly unknown[], contractName: string): CreatedContract {
  const matches = transactions
    .filter(isCreateTransaction)
    .filter((transaction) => transaction.contractName === contractName)
  if (matches.length !== 1) {
    throw new Error(`Forge broadcast must create ${contractName} exactly once`)
  }
  const transaction = matches[0]
  if (transaction === undefined) {
    throw new Error(`Forge broadcast is missing ${contractName}`)
  }
  return {
    address: getAddress(requiredNonzeroAddress(
      requiredString(transaction.contractAddress, `${contractName} contractAddress`),
      `${contractName} contractAddress`,
    )),
    transactionHash: requiredTransactionHash(transaction.hash, `${contractName} transaction hash`),
  }
}

function isCreateTransaction(value: unknown): value is Record<string, unknown> {
  return recordOrUndefined(value)?.transactionType === "CREATE"
}

function recordOrUndefined(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined
  return value as Record<string, unknown>
}
