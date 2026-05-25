import type { Abi, Address, Hex, PublicClient } from "viem"
import type { CamDocument, CamRuntimeContext } from "@cam/core"

export type CamHost = {
  readonly chainId: string
  readonly address: Address
}

export type ResourceLoader = (uri: string) => Promise<Uint8Array>

export type LoadedCam = {
  readonly host: CamHost
  readonly camURI: string
  readonly camHash: Hex
  readonly camBytes: Uint8Array
  readonly cam: CamDocument
}

export type ResolvedCamContract = {
  readonly name: string
  readonly address: Address
  readonly abiURI: string
  readonly abi: Abi
}

export type RouteResult = {
  readonly route: string
  readonly screenURI: string
  readonly raw: unknown
}

export type LoadCamFromHostOptions = {
  readonly publicClient: PublicClient
  readonly host: CamHost
  readonly loadResource: ResourceLoader
}

export type ResolveCamContractsOptions = {
  readonly publicClient: PublicClient
  readonly host: CamHost
  readonly camURI: string
  readonly cam: CamDocument
  readonly loadResource: ResourceLoader
}

export type CallCamRouteOptions = {
  readonly publicClient: PublicClient
  readonly cam: CamDocument
  readonly camURI: string
  readonly contracts: Record<string, ResolvedCamContract>
  readonly route: string
  readonly context: CamRuntimeContext
}

export type VerifyCamHashOptions = {
  readonly bytes: Uint8Array
  readonly expectedHash: Hex
}
