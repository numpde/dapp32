import { TextEncoder } from "node:util"

import {
  BIKE_CAM_URI,
  BIKE_COMPONENT_SCREEN_URI,
  BIKE_ENTRY_SCREEN_URI,
  BIKE_HOST_ADDRESS,
  BIKE_MANAGER_ABI_URI,
  BIKE_REGISTER_SCREEN_URI,
  BIKE_UI_ABI_URI,
  BIKE_UNSIGNED_CAM_HASH,
  bikeCamJson,
  bikeComponentScreen,
  bikeContractAddresses,
  bikeEntryScreen,
  bikeManagerAbi,
  bikeRegisterScreen,
  bikeUiAbi,
} from "./bike.mts"

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
  readonly address?: MockAddress
  readonly abi?: MockAbi
  readonly functionName: string
  readonly args?: readonly unknown[]
  readonly account?: MockAddress
}

type MockPublicClientOptions = {
  readonly camURI?: string
  readonly camHash?: MockHash
  readonly addresses?: Readonly<Record<string, MockAddress>>
  readonly routeResults?: Readonly<Record<string, unknown>>
  readonly hostAddress?: MockAddress
}

export function createMockCamPublicClient<ReadContract = (request: MockReadContractRequest) => Promise<unknown>>({
  camURI = BIKE_CAM_URI,
  camHash = BIKE_UNSIGNED_CAM_HASH,
  addresses = bikeContractAddresses,
  routeResults = {},
  hostAddress = BIKE_HOST_ADDRESS,
}: MockPublicClientOptions = {}): {
  readonly calls: MockReadContractCall[]
  readonly readContract: ReadContract
} {
  const calls: MockReadContractCall[] = []

  async function readContract(request: MockReadContractRequest): Promise<unknown> {
    const call: {
      address: MockAddress
      abi?: MockAbi
      functionName: string
      args?: readonly unknown[]
      account?: MockAddress
    } = {
      address: request.address ?? hostAddress,
      functionName: request.functionName,
    }
    if (request.abi !== undefined) call.abi = request.abi
    if (request.args !== undefined) call.args = request.args
    if (request.account !== undefined) call.account = request.account
    calls.push(call)

    if (request.functionName === "camURI") {
      return camURI
    }

    if (request.functionName === "camHash") {
      return camHash
    }

    if (request.functionName === "contractAddress") {
      const name = requireContractName(request.args)
      return addresses[name] !== undefined
        ? addresses[name]
        : ZERO_ADDRESS
    }

    if (Object.hasOwn(routeResults, request.functionName)) {
      return routeResults[request.functionName]
    }

    throw new Error(`unexpected readContract call: ${request.functionName}`)
  }

  return {
    calls,
    readContract: readContract as ReadContract,
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
  overrides: Readonly<Record<string, Uint8Array>> = {},
): Record<string, Uint8Array> {
  return {
    [BIKE_CAM_URI]: encodeJson(bikeCamJson),
    [BIKE_UI_ABI_URI]: encodeJson(bikeUiAbi),
    [BIKE_MANAGER_ABI_URI]: encodeJson(bikeManagerAbi),
    [BIKE_ENTRY_SCREEN_URI]: encodeJson(bikeEntryScreen),
    [BIKE_COMPONENT_SCREEN_URI]: encodeJson(bikeComponentScreen),
    [BIKE_REGISTER_SCREEN_URI]: encodeJson(bikeRegisterScreen),
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
