import type { TerminalBackend, TerminalBackendOptions } from "../types.ts"
import {
  readInertRecordEnv,
  requiredBooleanEnv,
  requiredEnv,
} from "../../input.ts"

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
    initialInputs: readInertRecordEnv(env, "CAM_VIEWER_INITIAL_INPUTS_JSON"),
  }
}
