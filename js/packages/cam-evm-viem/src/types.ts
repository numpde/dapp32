import type { Abi, Address, Chain, Hex } from "viem"
import type { CamDocument } from "@cam/core"
import type { InertValue } from "@cam/protocol"

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

export type LoadCamFromHostOptions = {
  readonly publicClient: CamPublicClient
  readonly host: CamHost
  readonly loadResource: ResourceLoader
  readonly allowUnsignedCamHash: boolean
}

export type LoadedCam = {
  readonly camURI: string
  readonly cam: CamDocument
}

export type VerifyCamHashOptions = {
  readonly bytes: Uint8Array
  readonly expectedHash: Hex
  readonly allowUnsigned: boolean
}

export type VerifyCamResourceIntegrityOptions = {
  readonly bytes: Uint8Array
  readonly integrity: string
  readonly uri: string
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
}

export type CamWalletClient = {
  readonly writeContract: (request: {
    readonly address: Address
    readonly abi: Abi
    readonly functionName: string
    readonly args?: readonly unknown[]
    readonly chain: Chain
  }) => Promise<Hex>
}

export type CamSimulationClient = {
  readonly simulateContract: (request: {
    readonly address: Address
    readonly abi: Abi
    readonly functionName: string
    readonly args?: readonly unknown[]
    readonly account: Address
  }) => Promise<unknown>
}

export type SimulateCamContractCallOptions = {
  readonly publicClient: CamSimulationClient
  readonly account: Address
  readonly call: CamContractCall
}

export type SendCamContractCallOptions = {
  readonly walletClient: CamWalletClient
  readonly chain: Chain
  readonly call: CamContractCall
}
