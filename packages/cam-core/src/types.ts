import type { InertValue } from "./inert-value.ts"

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

export type CamRuntimeContext = {
  readonly host: {
    readonly chainId: string
    readonly address: string
  }
  readonly account?: {
    readonly address: string
  }
  readonly params: Record<string, InertValue>
}

export type CamRouteCall = {
  readonly contract: string
  readonly function: string
  readonly args: readonly InertValue[]
}
