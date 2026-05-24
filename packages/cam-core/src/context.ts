import { CamError } from "./errors.ts"
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
  const host = input.host
  const account = input.account

  return {
    host: {
      chainId: requiredString(host.chainId, "host.chainId"),
      address: requiredString(host.address, "host.address"),
    },
    // Do not synthesize an anonymous account object. Routes that require
    // $account.address should fail when the account is genuinely absent.
    ...(account === undefined
      ? {}
      : {
          account: {
            address: requiredString(account.address, "account.address"),
          },
        }),
    params: requiredRecord(input.params, "params"),
    state: requiredRecord(input.state, "state"),
    outputs: requiredRecord(input.outputs, "outputs"),
  }
}

export function mergeContext(
  base: CamRuntimeContext,
  patch: Partial<CamRuntimeContext>,
): CamRuntimeContext {
  // The patch argument is intentionally required so callers do not use this as
  // a silent clone/defaulting path. Missing bags still come from the base.
  return createContext({
    host: {
      ...base.host,
      ...patch.host,
    },
    ...(base.account === undefined && patch.account === undefined
      ? {}
      : {
          account: {
            ...base.account,
            ...patch.account,
          },
        }),
    params: {
      ...base.params,
      ...patch.params,
    },
    state: {
      ...base.state,
      ...patch.state,
    },
    outputs: {
      ...base.outputs,
      ...patch.outputs,
    },
  })
}

function requiredRecord(value: Record<string, unknown> | undefined, path: string): Record<string, unknown> {
  if (value === undefined) {
    throw new CamError("CAM_INVALID_FIELD", "expected an object", path)
  }

  if (!isPlainObject(value)) {
    throw new CamError("CAM_INVALID_FIELD", "expected an object", path)
  }

  return { ...value }
}

function requiredString(value: unknown, path: string): string {
  if (typeof value !== "string") {
    throw new CamError("CAM_INVALID_FIELD", "expected a string", path)
  }

  if (value.length === 0) {
    throw new CamError("CAM_INVALID_FIELD", "expected a non-empty string", path)
  }

  return value
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}
