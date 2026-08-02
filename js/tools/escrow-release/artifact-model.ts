import type { Address } from "viem"

import { requiredJsonRecord, ZERO_ADDRESS } from "../release-values.ts"
import { createdContract } from "../release-provenance.ts"
import type { CreatedContract } from "../release-provenance.ts"

export type DeploymentContracts = {
  readonly camRoot: CreatedContract
  readonly camEscrow: CreatedContract
  readonly camEscrowUI: CreatedContract
}

export type OwnershipState = {
  readonly ownershipTransferRequired: boolean
  readonly ownershipAccepted: boolean
}

export function deploymentContractsFromBroadcast(broadcast: unknown): DeploymentContracts {
  const root = requiredJsonRecord(broadcast, "Forge broadcast")
  if (!Array.isArray(root.transactions)) {
    throw new Error("Forge broadcast must contain a transactions array")
  }

  return {
    camRoot: createdContract(root.transactions, "CamRoot"),
    camEscrow: createdContract(root.transactions, "CamEscrow"),
    camEscrowUI: createdContract(root.transactions, "CamEscrowUI"),
  }
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
