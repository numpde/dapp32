import type { Abi, Address, PublicClient } from "viem"
import type { Hex } from "viem"
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
