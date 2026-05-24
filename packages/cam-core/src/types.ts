export type CamDocument = {
  readonly $schema?: string
  readonly cam: string
  readonly name: string
  readonly description?: string
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
  readonly args: readonly unknown[]
}

export type CamRuntimeContext = {
  readonly host: {
    readonly chainId: string
    readonly address: string
  }
  readonly account?: {
    readonly address?: string
  }
  readonly params: Record<string, unknown>
  readonly state: Record<string, unknown>
  readonly outputs: Record<string, unknown>
}

export type CamRouteCall = {
  readonly contract: string
  readonly function: string
  readonly args: readonly unknown[]
}
