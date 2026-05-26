import type { Abi, Address, PublicClient } from "viem"
import type { CamDocument } from "@cam/core"
import type { InertValue } from "@cam/protocol"

export type CamPublicClient = Pick<PublicClient, "readContract">

export type CamHost = {
  readonly chainId: string
  readonly address: Address
}

export type ResourceLoader = (uri: string) => Promise<Uint8Array>

export type LoadedCam = {
  readonly camURI: string
  readonly cam: CamDocument
}

export type ResolvedCamContract = {
  readonly address: Address
  readonly abi: Abi
}

export type RouteResult = {
  readonly screenURI: string
  readonly values: readonly InertValue[]
}
