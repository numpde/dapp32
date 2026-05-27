import { createBikeMockBackend } from "./bike-mock.ts"
import type { TerminalBackend } from "../types.ts"

export function createTerminalBackendFromEnv(env: NodeJS.ProcessEnv): TerminalBackend {
  const backend = requiredEnv(env, "CAM_VIEWER_BACKEND")

  if (backend === "mock") {
    const mock = requiredEnv(env, "CAM_VIEWER_MOCK")
    if (mock === "bike-nft") {
      return createBikeMockBackend()
    }

    throw new Error(`unsupported CAM_VIEWER_MOCK: ${mock}`)
  }

  throw new Error(`unsupported CAM_VIEWER_BACKEND: ${backend}`)
}

function requiredEnv(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]
  if (value === undefined || value.length === 0) {
    throw new Error(`missing required environment variable: ${name}`)
  }

  return value
}
