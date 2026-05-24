import { cloneRequiredRecord, hasOwn, requiredNonEmptyString, requiredRecord } from "./guards.ts"
import type { CamRuntimeContext } from "./types.ts"

export type CamRuntimeContextInput = {
  readonly host: CamRuntimeContext["host"]
  // Absence means no connected account; if present, the address is required.
  readonly account?: {
    readonly address: string
  }
  readonly params: Record<string, unknown>
  readonly state: Record<string, unknown>
  readonly outputs: Record<string, unknown>
}

export function createContext(input: CamRuntimeContextInput): CamRuntimeContext {
  const source = requiredRecord(input, "")
  const host = requiredRecord(source.host, "host")
  const hasAccount = hasOwn(source, "account")

  return {
    host: {
      chainId: requiredNonEmptyString(host.chainId, "host.chainId"),
      address: requiredNonEmptyString(host.address, "host.address"),
    },
    // Do not synthesize an anonymous account object. Routes that require
    // $account.address should fail when the account is genuinely absent.
    ...(hasAccount
      ? {
          account: {
            address: requiredNonEmptyString(requiredRecord(source.account, "account").address, "account.address"),
          },
        }
      : {}),
    params: cloneRequiredRecord(source.params, "params"),
    state: cloneRequiredRecord(source.state, "state"),
    outputs: cloneRequiredRecord(source.outputs, "outputs"),
  }
}
