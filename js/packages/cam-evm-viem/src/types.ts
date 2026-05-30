import type { Abi, Address, Hex, PublicClient } from "viem"
import type { CamDocument } from "@cam/core"
import type { InertValue } from "@cam/protocol"

export type CamPublicClient = Pick<PublicClient, "readContract">

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

export type ResolvedCamContract = {
  readonly address: Address
  readonly abi: Abi
}

export type RouteResult = {
  readonly screenURI: string
  readonly values: readonly InertValue[]
}

export type CamContractCall = {
  readonly address: Address
  readonly abi: Abi
  readonly function: string
  readonly args: readonly InertValue[]
}

export type CamWalletClient = {
  readonly writeContract: (request: {
    readonly address: Address
    readonly abi: Abi
    readonly functionName: string
    readonly args?: readonly unknown[]
    readonly chain: null
  }) => Promise<Hex>
}

export type SendCamContractCallOptions = {
  readonly walletClient: CamWalletClient
  readonly call: CamContractCall
}
