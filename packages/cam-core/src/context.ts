import { CamError } from "./errors.ts"
import {
  rejectUnknownFields,
  requiredNonEmptyString,
  requiredRecord,
} from "./guards.ts"
import { createStringMap, hasOwn } from "./internal/json.ts"
import { toInertValue } from "./inert-value.ts"
import { CAM_CONTEXT_KEYS } from "./constants.ts"
import type { CamRuntimeContext } from "./types.ts"
import type { InertValue } from "./inert-value.ts"

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

function cloneContextRecord(value: unknown, path: string): Record<string, InertValue> {
  const source = requiredRecord(value, path)
  const clone = createStringMap<InertValue>()

  for (const [key, item] of Object.entries(source)) {
    clone[key] = toInertContextValue(item, `${path}.${key}`)
  }

  return clone
}

function toInertContextValue(value: unknown, path: string): InertValue {
  try {
    return toInertValue(value)
  } catch (error) {
    if (error instanceof CamError) {
      throw new CamError(error.code, error.message, error.path === undefined ? path : `${path}.${error.path}`)
    }

    throw error
  }
}
