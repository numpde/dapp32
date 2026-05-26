import type { CamRuntimeContext, InertValue } from "@cam/protocol"
export type { CamRuntimeContext } from "@cam/protocol"

export type CamDocument = {
  readonly cam: string
  readonly entry: string
  readonly contracts: Record<string, CamContract>
  readonly routes: Record<string, CamRoute>
}

export type CamContract = {
  readonly abiURI: string
}

export type CamRoute = {
  readonly contract: string
  readonly function: string
  readonly args: readonly InertValue[]
}

export type CamRouteCall = {
  readonly contract: string
  readonly function: string
  readonly args: readonly InertValue[]
}
