import {
  isRecordObject,
  parseJsonText,
  toInertValue,
} from "../../../packages/cam-protocol/dist/index.js"
import type { InertRecord } from "../../../packages/cam-protocol/dist/index.js"
import type { TerminalBackend, TerminalBackendOptions } from "../types.ts"

export async function createTerminalBackendFromEnv(env: NodeJS.ProcessEnv): Promise<TerminalBackend> {
  const backend = requiredEnv(env, "CAM_VIEWER_BACKEND")

  if (backend === "mock") {
    const mock = requiredEnv(env, "CAM_VIEWER_MOCK")
    if (mock === "bike-nft") {
      const { createBikeMockBackend } = await import("./bike-mock.ts")
      return createBikeMockBackend(readBackendOptions(env))
    }

    throw new Error(`unsupported CAM_VIEWER_MOCK: ${mock}`)
  }

  if (backend === "local-rpc") {
    const { createLocalRpcBackend } = await import("./local-rpc.ts")
    return createLocalRpcBackend(env, readBackendOptions(env))
  }

  throw new Error(`unsupported CAM_VIEWER_BACKEND: ${backend}`)
}

function readBackendOptions(env: NodeJS.ProcessEnv): TerminalBackendOptions {
  return {
    allowUnsignedCamHash: requiredBooleanEnv(env, "CAM_VIEWER_ALLOW_UNSIGNED_CAM_HASH"),
    initialParams: readInertRecordEnv(env, "CAM_VIEWER_INITIAL_PARAMS_JSON"),
  }
}

function requiredBooleanEnv(env: NodeJS.ProcessEnv, name: string): boolean {
  const value = requiredEnv(env, name)
  if (value === "true") return true
  if (value === "false") return false
  throw new Error(`${name}: expected "true" or "false"`)
}

function readInertRecordEnv(env: NodeJS.ProcessEnv, name: string): InertRecord {
  const value = toInertValue(parseJsonText(requiredEnv(env, name)))
  if (!isRecordObject(value)) {
    throw new Error(`${name}: expected a JSON object`)
  }

  return value
}

function requiredEnv(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]
  if (value === undefined || value.length === 0) {
    throw new Error(`missing required environment variable: ${name}`)
  }

  return value
}
