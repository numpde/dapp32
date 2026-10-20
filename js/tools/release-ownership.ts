import { zeroAddress, type Address } from "viem"

export type OwnershipState = {
  readonly ownershipTransferRequired: boolean
  readonly ownershipAccepted: boolean
}

export function ownershipState({
  deployer,
  intendedOwner,
  owner,
  pendingOwner,
  label,
}: {
  readonly deployer: Address
  readonly intendedOwner: Address
  readonly owner: Address
  readonly pendingOwner: Address
  readonly label: string
}): OwnershipState {
  const normalizedDeployer = deployer.toLowerCase()
  const normalizedIntendedOwner = intendedOwner.toLowerCase()
  const normalizedOwner = owner.toLowerCase()
  const normalizedPendingOwner = pendingOwner.toLowerCase()
  const zero = zeroAddress.toLowerCase()

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
    `unexpected ${label} ownership state: deployer=${deployer} intended=${intendedOwner} owner=${owner} pending=${pendingOwner}`,
  )
}
