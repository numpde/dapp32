import { resolve } from "node:path"

import type {
  CamHost,
} from "../../../packages/cam-evm-viem/dist/index.js"
import {
  createCamViewerSession,
} from "../../../packages/cam-viewer/dist/index.js"
import {
  requireSameHttpOrigin,
  toInertValue,
} from "../../../packages/cam-protocol/dist/index.js"
import type { InertValue } from "../../../packages/cam-protocol/dist/index.js"
import {
  checkedContainedFilePath,
  readBoundedFile,
} from "../../local-cam-files.ts"
import { formatValue } from "../format.ts"
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
  type BikeComponentFixtureStatus,
} from "../../../../tests/fixtures/cam/bike.mts"

import type {
  DebugEvent,
  TerminalBackend,
  TerminalBackendOptions,
  TerminalPublicClient,
} from "../types.ts"

type MockAddress = CamHost["address"]

const BIKE_MOCK_CAM_ORIGIN = "http://bike-nft.mock.local"
const BIKE_MOCK_CAM_BASE_URI = `${BIKE_MOCK_CAM_ORIGIN}/`
const BIKE_MOCK_CAM_URI = new URL("main.json", BIKE_MOCK_CAM_BASE_URI).href
const BIKE_MOCK_CAM_BASE_PATH = "/work/cam/bike-nft"

export type BikeMockBackendOptions = TerminalBackendOptions & {
  readonly componentStatus: BikeComponentFixtureStatus
}

export function createBikeMockBackend({
  allowUnsignedCamHash,
  componentStatus,
  initialInputs,
}: BikeMockBackendOptions): TerminalBackend {
  return {
    name: "mock:bike-nft",
    description: `offline bike NFT fixture (${componentStatus} component)`,
    hostLabel: `${BIKE_HOST_CHAIN_ID} ${BIKE_HOST_ADDRESS}`,
    createSession(events) {
      return createCamViewerSession({
        publicClient: createMockPublicClient(events, componentStatus),
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

function createMockPublicClient(events: DebugEvent[], componentStatus: BikeComponentFixtureStatus): TerminalPublicClient {
  const publicClient: TerminalPublicClient = {
    async getChainId(): Promise<number> {
      return 31337
    },
    async readContract(request) {
      const args = request.args === undefined
        ? []
        : request.args.map((arg) => toInertValue(arg))
      const result = mockReadContract(request.functionName, args, componentStatus)
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

function mockReadContract(
  functionName: string,
  args: readonly InertValue[],
  componentStatus: BikeComponentFixtureStatus,
): unknown {
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
      return bikeAddressForContract(requireStringArgs(functionName, args, 1)[0])
    case BIKE_VIEW_ENTRY:
      return bikeEntryRouteResult(requireStringArgs(functionName, args, 1)[0])
    case BIKE_VIEW_COMPONENT: {
      const routeArgs = requireStringArgs(functionName, args, 2)
      return bikeComponentRouteResult(routeArgs[0], routeArgs[1], componentStatus)
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
  if (args.length !== length) {
    throw new Error(`${functionName} expected ${length} string argument(s), got ${formatValue(args)}`)
  }

  return args.map((arg) => {
    if (typeof arg !== "string") {
      throw new Error(`${functionName} expected ${length} string argument(s), got ${formatValue(args)}`)
    }

    return arg
  })
}

function createMockResourceLoader(events: DebugEvent[]): (uri: string) => Promise<Uint8Array> {
  return async (uri: string): Promise<Uint8Array> => {
    const resourceURI = requireSameHttpOrigin(uri, BIKE_MOCK_CAM_ORIGIN, "mock CAM resource URI")
    if (resourceURI.search !== "" || resourceURI.hash !== "") {
      throw new Error(`mock CAM resource URI must not include query or fragment: ${resourceURI.href}`)
    }
    if (resourceURI.pathname.includes("%") || resourceURI.pathname.includes("\\")) {
      throw new Error(`mock CAM resource URI must be reviewable path text: ${resourceURI.href}`)
    }

    const resourcePath = await checkedMockCamFilePath(resourceURI)
    const bytes = await readBoundedFile(resourcePath, `mock CAM resource ${resourceURI.href}`)
    events.push({
      step: events.length + 1,
      kind: "resource-load",
      uri: resourceURI.href,
      bytes: bytes.byteLength,
    })
    return bytes
  }
}

async function checkedMockCamFilePath(uri: { readonly href: string; readonly pathname: string }): Promise<string> {
  // The mock exposes an HTTP-shaped CAM root so it exercises the same runtime
  // URI policy as real sessions, but it still reads checked-in files. Reuse the
  // file boundary that rejects symlink hops and escaped realpaths.
  return checkedContainedFilePath({
    rootDir: BIKE_MOCK_CAM_BASE_PATH,
    path: resolve(BIKE_MOCK_CAM_BASE_PATH, `.${uri.pathname}`),
    label: `bike mock CAM resource ${uri.href}`,
    boundaryLabel: "bike mock CAM directory",
  })
}
