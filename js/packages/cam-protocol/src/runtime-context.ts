import type { InertRecord, InertValue } from "./inert-value.ts"

export const CAM_ROUTE_CONTEXT_KEYS: ReadonlySet<string> = new Set(["host", "account", "inputs", "outputs"])

export type CamRuntimeContext = {
  readonly host: {
    readonly chainId: string
    readonly address: string
  }
  readonly account?: {
    readonly address: string
  }
  readonly inputs: InertRecord
  readonly outputs: readonly InertValue[]
}
