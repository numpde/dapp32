import { readFile, stat } from "node:fs/promises"
import { fileURLToPath } from "node:url"

import type {
  CamHost,
} from "../../../packages/cam-evm-viem/dist/index.js"
import {
  createCamViewerSession,
} from "../../../packages/cam-viewer/dist/index.js"
import {
  CAM_RESOURCE_MAX_BYTES,
  toInertValue,
} from "../../../packages/cam-protocol/dist/index.js"
import type { InertValue } from "../../../packages/cam-protocol/dist/index.js"
import {
  BIKE_ACCOUNT_ADDRESS,
  BIKE_HOST_ADDRESS,
  BIKE_HOST_CHAIN_ID,
  BIKE_UNSIGNED_CAM_HASH,
  BIKE_VIEW_COMPONENT,
  BIKE_VIEW_ENTRY,
  BIKE_VIEW_REGISTER,
  bikeAddressForContract,
  bikeComponentRouteResult,
  bikeEntryRouteResult,
  bikeRegisterRouteResult,
} from "../../../../tests/fixtures/cam/bike.mts"

import type {
  DebugEvent,
  TerminalBackend,
  TerminalBackendOptions,
  TerminalPublicClient,
} from "../types.ts"

type MockAddress = CamHost["address"]

const BIKE_MOCK_CAM_BASE_URI = "file:///work/cam/bike-nft/"
const BIKE_MOCK_CAM_URI = new URL("main.json", BIKE_MOCK_CAM_BASE_URI).href

export function createBikeMockBackend({
  allowUnsignedCamHash,
  initialInputs,
}: TerminalBackendOptions): TerminalBackend {
  return {
    name: "mock:bike-nft",
    description: "offline bike NFT fixture",
    hostLabel: `${BIKE_HOST_CHAIN_ID} ${BIKE_HOST_ADDRESS}`,
    createSession(events) {
      return createCamViewerSession({
        publicClient: createMockPublicClient(events),
        host: {
          chainId: BIKE_HOST_CHAIN_ID,
          address: BIKE_HOST_ADDRESS,
        },
        account: {
          address: BIKE_ACCOUNT_ADDRESS,
        },
        inputs: initialInputs,
        allowUnsignedCamHash,
        loadResource: createMockResourceLoader(events),
      })
    },
  }
}

function createMockPublicClient(events: DebugEvent[]): TerminalPublicClient {
  const publicClient: TerminalPublicClient = {
    async getChainId(): Promise<number> {
      return 31337
    },
    async readContract(request: {
      readonly functionName: string
      readonly args?: readonly unknown[]
    }): Promise<unknown> {
      const args = request.args === undefined
        ? []
        : request.args.map((arg) => toInertValue(arg))
      const result = mockReadContract(request.functionName, args)
      events.push({
        step: events.length + 1,
        kind: "contract-read",
        functionName: request.functionName,
        args,
        result,
      })
      return result
    },
  }

  return publicClient
}

function mockReadContract(functionName: string, args: readonly InertValue[]): unknown {
  switch (functionName) {
    case "camURI":
      requireNoArgs(functionName, args)
      return BIKE_MOCK_CAM_URI
    case "camHash":
      requireNoArgs(functionName, args)
      return BIKE_UNSIGNED_CAM_HASH
    case "supportsInterface":
      requireStringArgs(functionName, args, 1)
      return true
    case "contractAddress":
      return contractAddress(requireStringArgs(functionName, args, 1)[0])
    case BIKE_VIEW_ENTRY:
      return bikeEntryRouteResult(requireStringArgs(functionName, args, 1)[0])
    case BIKE_VIEW_COMPONENT: {
      const routeArgs = requireStringArgs(functionName, args, 2)
      return bikeComponentRouteResult(routeArgs[0], routeArgs[1])
    }
    case BIKE_VIEW_REGISTER: {
      const routeArgs = requireStringArgs(functionName, args, 2)
      return bikeRegisterRouteResult(routeArgs[0], routeArgs[1])
    }
    default:
      throw new Error(`unexpected readContract call: ${functionName}`)
  }
}

function requireNoArgs(functionName: string, args: readonly InertValue[]): void {
  if (args.length !== 0) {
    throw new Error(`${functionName} expected no arguments, got ${args.length}`)
  }
}

function requireStringArgs(
  functionName: string,
  args: readonly InertValue[],
  length: number,
): readonly string[] {
  if (args.length !== length || args.some((arg) => typeof arg !== "string")) {
    throw new Error(`${functionName} expected ${length} string argument(s), got ${formatValue(args)}`)
  }

  return args as readonly string[]
}

function contractAddress(name: string): MockAddress {
  return bikeAddressForContract(name) as MockAddress
}

function createMockResourceLoader(events: DebugEvent[]): (uri: string) => Promise<Uint8Array> {
  return async (uri: string): Promise<Uint8Array> => {
    const resourceURI = new URL(uri)
    if (resourceURI.protocol !== "file:") {
      throw new Error(`mock terminal loads file resources only: ${resourceURI.protocol}`)
    }

    requireMockCamFileURI(resourceURI)
    const resourcePath = fileURLToPath(resourceURI)
    const metadata = await stat(resourcePath)
    if (metadata.size > CAM_RESOURCE_MAX_BYTES) {
      throw new Error(`mock CAM resource is too large: ${resourceURI.href}`)
    }

    const bytes = await readFile(resourcePath)
    events.push({
      step: events.length + 1,
      kind: "resource-load",
      uri: resourceURI.href,
      bytes: bytes.byteLength,
    })
    return bytes
  }
}

function requireMockCamFileURI(uri: URL): void {
  if (!uri.href.startsWith(BIKE_MOCK_CAM_BASE_URI)) {
    throw new Error(`bike mock terminal can only load checked-in bike CAM files: ${uri.href}`)
  }
}

function formatValue(value: unknown): string {
  if (typeof value === "bigint") {
    return value.toString()
  }

  if (typeof value === "string") {
    return value
  }

  return JSON.stringify(value)
}
