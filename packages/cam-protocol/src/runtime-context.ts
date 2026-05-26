import type { InertRecord } from "./inert-value.ts"

export type CamRuntimeContext = {
  readonly host: {
    readonly chainId: string
    readonly address: string
  }
  readonly account?: {
    readonly address: string
  }
  readonly params: InertRecord
}
