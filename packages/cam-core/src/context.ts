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

function requiredRecord(value: Record<string, unknown> | undefined, path: string): Record<string, unknown> {
  if (value === undefined) {
    throw new CamError("CAM_INVALID_FIELD", "expected an object", path)
  }

  if (!isRecordObject(value)) {
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

function isRecordObject(value: unknown): value is Record<string, unknown> {
  // CAM runtime bags are JSON-style records. Arrays, null, and primitives are
  // rejected before callers can read arbitrary fields from unknown input.
  return value !== null && typeof value === "object" && !Array.isArray(value)
}
