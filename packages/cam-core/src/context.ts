import { CamError } from "./errors.ts"
import { hasOwn, isRecordObject, requiredNonEmptyString, requiredRecord } from "./guards.ts"
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
    params: cloneContextRecord(source.params, "params"),
    state: cloneContextRecord(source.state, "state"),
    outputs: cloneContextRecord(source.outputs, "outputs"),
  }
}

function cloneContextRecord(value: unknown, path: string): Record<string, unknown> {
  const source = requiredRecord(value, path)
  const clone = Object.create(null) as Record<string, unknown>

  for (const [key, item] of Object.entries(source)) {
    clone[key] = cloneContextValue(item, `${path}.${key}`)
  }

  return clone
}

function cloneContextValue(value: unknown, path: string): unknown {
  if (value === undefined || typeof value === "function" || typeof value === "symbol") {
    throw new CamError("CAM_INVALID_FIELD", "expected runtime context data", path)
  }

  if (typeof value === "number" && !Number.isFinite(value)) {
    throw new CamError("CAM_INVALID_FIELD", "expected a finite number", path)
  }

  if (Array.isArray(value)) {
    return value.map((item, index) => cloneContextValue(item, `${path}.${index}`))
  }

  if (isRecordObject(value)) {
    return cloneContextRecord(value, path)
  }

  if (value !== null && typeof value === "object") {
    throw new CamError("CAM_INVALID_FIELD", "expected runtime context data", path)
  }

  return value
}
