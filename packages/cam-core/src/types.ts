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
  // TODO(inert-values): CAM route arguments are manifest data and should be
  // typed as readonly InertValue[] once the core public API is migrated.
  readonly args: readonly unknown[]
}

export type CamRuntimeContext = {
  readonly host: {
    readonly chainId: string
    readonly address: string
  }
  readonly account?: {
    readonly address: string
  }
  // TODO(inert-values): runtime params are untrusted host input and should be
  // Record<string, InertValue>, not arbitrary unknown values.
  readonly params: Record<string, unknown>
}

export type CamRouteCall = {
  readonly contract: string
  readonly function: string
  // TODO(inert-values): resolved route arguments should preserve the same
  // inert-value boundary before the EVM adapter ABI-encodes them.
  readonly args: readonly unknown[]
}
