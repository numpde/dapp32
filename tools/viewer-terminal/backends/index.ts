import type { TerminalBackend } from "../types.ts"

export async function createTerminalBackendFromEnv(env: NodeJS.ProcessEnv): Promise<TerminalBackend> {
  const backend = requiredEnv(env, "CAM_VIEWER_BACKEND")

  if (backend === "mock") {
    const mock = requiredEnv(env, "CAM_VIEWER_MOCK")
    if (mock === "bike-nft") {
      const { createBikeMockBackend } = await import("./bike-mock.ts")
      return createBikeMockBackend()
    }

    throw new Error(`unsupported CAM_VIEWER_MOCK: ${mock}`)
  }

  if (backend === "local-rpc") {
    const { createLocalRpcBackend } = await import("./local-rpc.ts")
    return createLocalRpcBackend(env)
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
