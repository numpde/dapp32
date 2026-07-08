import type { TerminalBackend, TerminalBackendOptions } from "../types.ts"
import {
  readInertRecordEnv,
  requiredBooleanEnv,
  requiredEnv,
} from "../../input.ts"
import type { BikeComponentFixtureStatus } from "../../../../tests/fixtures/cam/bike.mts"

export async function createTerminalBackendFromEnv(env: NodeJS.ProcessEnv): Promise<TerminalBackend> {
  const backend = requiredEnv(env, "CAM_VIEWER_BACKEND")

  if (backend === "mock") {
    const mock = requiredEnv(env, "CAM_VIEWER_MOCK")
    if (mock === "bike-nft") {
      const { createBikeMockBackend } = await import("./bike-mock.ts")
      return createBikeMockBackend({
        ...readBackendOptions(env),
        componentStatus: readBikeMockComponentStatus(env),
      })
    }

    throw new Error(`unsupported CAM_VIEWER_MOCK: ${mock}`)
  }

  if (backend === "local-rpc") {
    const { createLocalRpcBackend } = await import("./local-rpc.ts")
    return createLocalRpcBackend(env, readBackendOptions(env))
  }

  throw new Error(`unsupported CAM_VIEWER_BACKEND: ${backend}`)
}

function readBikeMockComponentStatus(env: NodeJS.ProcessEnv): BikeComponentFixtureStatus {
  const value = env.CAM_VIEWER_BIKE_MOCK_COMPONENT_STATUS
  // The historical offline fixture is the active component branch. Operators
  // can opt into missing/retired views without pretending prepared writes mutate
  // mock chain state.
  if (value === undefined) return "active"
  if (value === "active" || value === "missing" || value === "retired") return value

  throw new Error(`CAM_VIEWER_BIKE_MOCK_COMPONENT_STATUS must be active, missing, or retired: ${value}`)
}

function readBackendOptions(env: NodeJS.ProcessEnv): TerminalBackendOptions {
  return {
    allowUnsignedCamHash: requiredBooleanEnv(env, "CAM_VIEWER_ALLOW_UNSIGNED_CAM_HASH"),
    initialInputs: readInertRecordEnv(env, "CAM_VIEWER_INITIAL_INPUTS_JSON"),
  }
}
