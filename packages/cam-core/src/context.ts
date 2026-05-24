import { CamError } from "./errors.ts"
import {
  createStringMap,
  hasOwn,
  isRecordObject,
  rejectUnknownFields,
  requiredNonEmptyString,
  requiredRecord,
} from "./guards.ts"
import { CAM_CONTEXT_KEYS } from "./constants.ts"
import type { CamRuntimeContext } from "./types.ts"

export function createContext(input: unknown): CamRuntimeContext {
  const source = requiredRecord(input, "")
  rejectUnknownContextFields(source)

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
  }
}

function rejectUnknownContextFields(source: Record<string, unknown>): void {
  // Core owns only the data needed to resolve route-call arguments. UI state,
  // previous call outputs, caches, and renderer-local data belong above core.
  rejectUnknownFields(
    source,
    CAM_CONTEXT_KEYS,
    "",
    (key) => `field is not allowed in CAM runtime context: ${key}`,
  )
}

function cloneContextRecord(value: unknown, path: string): Record<string, unknown> {
  const source = requiredRecord(value, path)
  const clone = createStringMap<unknown>()

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
