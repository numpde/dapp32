import type { Address } from "viem"
import { requiredNonzeroAddress } from "../release-values.ts"

// An address reference is resolved only after the named creation receipt succeeds.
export type ExpectedArgument = string | { readonly createdContract: string }

export type ExpectedStep = {
  readonly kind: "create" | "call"
  readonly role: string
  readonly name: string
  readonly action: string
  readonly argumentLabels: readonly string[]
  readonly signature?: string
  readonly constructorTypes?: readonly string[]
  readonly args: readonly ExpectedArgument[]
}

export type ReleaseReference = {
  readonly sourceCommit: string
  readonly expectedChainId: number
  readonly expectedDeployer: Address
  readonly steps: readonly ExpectedStep[]
}

export function expectedDeployer(value: string): Address {
  return requiredNonzeroAddress(value, "independently selected deployer")
}

export function createdContract(role: string): { readonly createdContract: string } {
  return { createdContract: role }
}
