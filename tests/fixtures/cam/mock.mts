import { TextEncoder } from "node:util"

import {
  BIKE_CAM_URI,
  BIKE_MANAGER_ABI_URI,
  BIKE_UI_ABI_URI,
  BIKE_UI_URI,
} from "./bike.mts"
import {
  bikeCamBytes,
  bikeManagerAbiBytes,
  bikeUiAbiBytes,
  bikeUiBytes,
} from "./bike-resources.mts"

export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000"

export type MockAddress = `0x${string}`
export type MockHash = `0x${string}`
export type MockAbi = readonly unknown[]

export type MockReadContractCall = {
  readonly address: MockAddress
  readonly abi?: MockAbi
  readonly functionName: string
  readonly args?: readonly unknown[]
  readonly account?: MockAddress
}

type MockReadContractRequest = {
  readonly address: MockAddress
  readonly abi?: MockAbi | undefined
  readonly functionName: string
  readonly args?: readonly unknown[] | undefined
  readonly account?: MockAddress | undefined
}

type MockPublicClientOptions = {
  readonly chainId: number
  readonly camURI: string
  readonly camHash: MockHash
  readonly supportsCamInterface: boolean
  readonly addresses: Readonly<Partial<Record<string, MockAddress>>>
  readonly routeResults: Readonly<Record<string, unknown>>
}

export function createMockCamPublicClient({
  chainId,
  camURI,
  camHash,
  supportsCamInterface,
  addresses,
  routeResults,
}: MockPublicClientOptions): {
  readonly calls: MockReadContractCall[]
  readonly chainCalls: number
  readonly getChainId: () => Promise<number>
  readonly readContract: (request: MockReadContractRequest) => Promise<unknown>
} {
  const calls: MockReadContractCall[] = []
  let chainCalls = 0

  async function getChainId(): Promise<number> {
    chainCalls += 1
    return chainId
  }

  async function readContract(request: MockReadContractRequest): Promise<unknown> {
    const call: {
      address: MockAddress
      abi?: MockAbi
      functionName: string
      args?: readonly unknown[]
      account?: MockAddress
    } = {
      address: request.address,
      functionName: request.functionName,
    }
    if (request.abi !== undefined) call.abi = request.abi
    if (request.args !== undefined) call.args = request.args
    if (request.account !== undefined) call.account = request.account
    calls.push(call)

    if (request.functionName === "supportsInterface") {
      return supportsCamInterface
    }

    if (request.functionName === "camURI") {
      return camURI
    }

    if (request.functionName === "camHash") {
      return camHash
    }

    if (request.functionName === "contractAddress") {
      const name = requireContractName(request.args)
      return contractAddressForName(addresses, name)
    }

    if (Object.hasOwn(routeResults, request.functionName)) {
      return routeResults[request.functionName]
    }

    throw new Error(`unexpected readContract call: ${request.functionName}`)
  }

  return {
    calls,
    get chainCalls() {
      return chainCalls
    },
    getChainId,
    readContract,
  }
}

export function createMockResourceLoader(resources: Readonly<Record<string, Uint8Array>>) {
  return async (uri: string): Promise<Uint8Array> => {
    const bytes = resources[uri]
    if (bytes === undefined) {
      throw new Error(`unexpected resource URI: ${uri}`)
    }

    return bytes
  }
}

export function bikeResourceBytes(
  overrides: Readonly<Record<string, Uint8Array>>,
): Record<string, Uint8Array> {
  return {
    [BIKE_CAM_URI]: bikeCamBytes,
    [BIKE_UI_ABI_URI]: bikeUiAbiBytes,
    [BIKE_MANAGER_ABI_URI]: bikeManagerAbiBytes,
    [BIKE_UI_URI]: bikeUiBytes,
    ...overrides,
  }
}

export function encodeJson(value: unknown): Uint8Array {
  return encodeText(JSON.stringify(value))
}

export function encodeText(value: string): Uint8Array {
  return new TextEncoder().encode(value)
}

function requireContractName(args: readonly unknown[] | undefined): string {
  if (args?.length !== 1 || typeof args[0] !== "string") {
    throw new Error("contractAddress expected one string argument")
  }

  return args[0]
}

function contractAddressForName(
  addresses: Readonly<Partial<Record<string, MockAddress>>>,
  name: string,
): MockAddress {
  const address = addresses[name]
  if (address !== undefined) {
    return address
  }

  return ZERO_ADDRESS
}
