import type { Abi, Address, Chain, Hex } from "viem"
import type { CamDocument } from "@cam/core"
import type { InertValue } from "@cam/protocol"

import type { EvmTransactionValue } from "./abi-values.ts"

// Keep the adapter boundary smaller than viem's full generic PublicClient.
// Mocks and package consumers should satisfy the CAM read surface, not viem's
// overload-heavy implementation type.
export type CamReadContractRequest = {
  readonly address: Address
  readonly abi: Abi | readonly unknown[]
  readonly functionName: string
  readonly args?: readonly unknown[] | undefined
  readonly account?: Address | undefined
}

export type CamPublicClient = {
  readonly getChainId: () => Promise<number>
  readonly readContract: (request: CamReadContractRequest) => Promise<unknown>
}

export type CamHost = {
  readonly chainId: string
  readonly address: Address
}

export type ResourceLoader = (uri: string) => Promise<Uint8Array>

export type CamIntegrityWarning = {
  readonly hashSource: "contract" | "manifest"
  readonly status: "mismatch" | "unverified"
  readonly uri: string
  readonly expectedHash: string
  readonly actualHash: string
}

export type LoadCamFromHostOptions = {
  readonly publicClient: CamPublicClient
  readonly host: CamHost
  readonly loadResource: ResourceLoader
  readonly onIntegrityWarning?: (warning: CamIntegrityWarning) => void
}

export type LoadedCam = {
  readonly camURI: string
  readonly cam: CamDocument
}

export type VerifyCamHashOptions = {
  readonly bytes: Uint8Array
  readonly expectedHash: Hex
  readonly onIntegrityWarning?: (warning: Omit<CamIntegrityWarning, "uri">) => void
}

export type VerifyCamResourceIntegrityOptions = {
  readonly bytes: Uint8Array
  readonly integrity: string
  readonly uri: string
  readonly onIntegrityWarning?: (warning: CamIntegrityWarning) => void
}

export type ResolvedCamContract = {
  readonly address: Address
  readonly abi: Abi
}

export type RouteResult = {
  readonly values: readonly InertValue[]
}

export type CamContractCall = {
  readonly address: Address
  readonly abi: Abi
  readonly function: string
  readonly args: Record<string, InertValue>
  readonly value?: InertValue
}

export type CamWalletClient<TChain extends Chain | null = Chain> = {
  readonly writeContract: (request: {
    readonly address: Address
    readonly abi: Abi
    readonly functionName: string
    readonly args?: readonly unknown[]
    readonly value?: EvmTransactionValue
    readonly chain: TChain
  }) => Promise<Hex>
}

export type CamSimulationClient = {
  readonly simulateContract: (request: {
    readonly address: Address
    readonly abi: Abi
    readonly functionName: string
    readonly args?: readonly unknown[]
    readonly value?: EvmTransactionValue
    readonly account: Address
  }) => Promise<unknown>
}

export type SimulateCamContractCallOptions = {
  readonly publicClient: CamSimulationClient
  readonly account: Address
  readonly call: CamContractCall
}

export type SendCamContractCallOptions<TChain extends Chain | null = Chain> = {
  readonly walletClient: CamWalletClient<TChain>
  /** With null, the supplied wallet client must enforce the target chain. */
  readonly chain: TChain
  readonly call: CamContractCall
}
