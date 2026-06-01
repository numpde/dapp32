import assert from "node:assert/strict"
import test from "node:test"

import { parseCam } from "@cam/core"
import { toInertValue } from "@cam/protocol"
import type { Abi, Address, Hex } from "viem"

import {
  CamEvmError,
  callCamRoute,
  loadCamFromHost,
  resolveCamContracts,
  sendCamContractCall,
  simulateCamContractCall,
} from "../src/index.ts"
import type { CamHost, CamPublicClient, CamSimulationClient, CamWalletClient } from "../src/index.ts"
import {
  BIKE_ACCOUNT_ADDRESS as userAddress,
  BIKE_CAM_URI as camDocumentURI,
  BIKE_MANAGER_ABI_URI as managerAbiURI,
  BIKE_MANAGER_ADDRESS as managerAddress,
  BIKE_MANAGER_CONTRACT,
  BIKE_MANAGER_NAMESPACE,
  BIKE_MARK_MISSING,
  BIKE_ROUTE_COMPONENT,
  BIKE_ROUTE_ENTRY,
  BIKE_SERIAL_NUMBER,
  BIKE_UNSIGNED_CAM_HASH,
  BIKE_UI_ABI_URI as uiAbiURI,
  BIKE_UI_ADDRESS as uiAddress,
  BIKE_UI_CONTRACT,
  BIKE_UI_NAMESPACE,
  BIKE_VIEW_COMPONENT,
  BIKE_VIEW_ENTRY,
  bikeCamJson as camJson,
  bikeContractAddresses,
  bikeHost,
  bikeManagerAbi as managerAbiJson,
  bikeRouteResults,
  bikeUiAbi as uiAbiJson,
} from "../../../../tests/fixtures/cam/bike.mts"
import {
  createMockCamPublicClient,
  createMockResourceLoader as createResourceLoader,
  encodeJson,
} from "../../../../tests/fixtures/cam/mock.mts"

const host: CamHost = bikeHost
const ROOT_CAM_URI = "camURI"
const ROOT_CAM_HASH = "camHash"
const NO_ROUTE_RESULTS = {}
const uiAbi = uiAbiJson as Abi
const managerAbi = managerAbiJson as Abi

test("loadCamFromHost reads root metadata, parses namespaced CAMs, and rejects hash mismatches", async () => {
  const camBytes = encodeJson(camJson)
  const publicClient = createPublicClient(publicClientFixtureOptions({
    camURI: camDocumentURI,
    camHash: BIKE_UNSIGNED_CAM_HASH,
  }))
  const resources = createResourceLoader({
    [camDocumentURI]: camBytes,
  })

  const loaded = await loadCamFromHost({
    publicClient,
    host,
    loadResource: resources,
    allowUnsignedCamHash: true,
  })

  assert.equal(loaded.camURI, camDocumentURI)
  assert.deepEqual(loaded.cam, parseCam(camJson))
  assert.deepEqual(publicClient.calls.map((call) => call.functionName), [
    ROOT_CAM_URI,
    ROOT_CAM_HASH,
  ])

  await assert.rejects(
    () => loadCamFromHost({
      publicClient: createPublicClient(publicClientFixtureOptions({
        camURI: camDocumentURI,
        camHash: "0x1111111111111111111111111111111111111111111111111111111111111111",
      })),
      host,
      loadResource: resources,
      allowUnsignedCamHash: false,
    }),
    (error) => error instanceof CamEvmError && error.code === "CAM_HASH_MISMATCH",
  )
})

test("resolveCamContracts resolves namespaced contracts through CamRoot", async () => {
  const cam = parseCam(camJson)
  const publicClient = createPublicClient(publicClientFixtureOptions({
    addresses: {
      [BIKE_UI_CONTRACT]: uiAddress,
      [BIKE_MANAGER_CONTRACT]: managerAddress,
    },
  }))
  const resources = createResourceLoader({
    [uiAbiURI]: encodeJson(uiAbi),
    [managerAbiURI]: encodeJson(managerAbi),
  })

  const contracts = await resolveCamContracts({
    publicClient,
    host,
    camURI: camDocumentURI,
    cam,
    loadResource: resources,
  })

  assert.equal(contracts[BIKE_UI_NAMESPACE].address, uiAddress)
  assert.equal(contracts[BIKE_MANAGER_NAMESPACE].address, managerAddress)
  assert.deepEqual(contracts[BIKE_UI_NAMESPACE].abi, uiAbi)
  assert.equal(Object.getPrototypeOf(contracts), null)
})

test("resolveCamContracts rejects invalid bindings and malformed ABIs", async () => {
  await assert.rejects(
    () => resolveCamContracts({
      publicClient: createPublicClient(publicClientFixtureOptions({
        addresses: {
          [BIKE_UI_CONTRACT]: "not-an-address" as Address,
          [BIKE_MANAGER_CONTRACT]: managerAddress,
        },
      })),
      host,
      camURI: camDocumentURI,
      cam: parseCam(camJson),
      loadResource: createResourceLoader({
        [uiAbiURI]: encodeJson(uiAbi),
        [managerAbiURI]: encodeJson(managerAbi),
      }),
    }),
    (error) => error instanceof CamEvmError && error.code === "CAM_CONTRACT_INVALID",
  )

  await assert.rejects(
    () => resolveCamContracts({
      publicClient: createPublicClient(publicClientFixtureOptions({
        addresses: {
          [BIKE_UI_CONTRACT]: uiAddress,
          [BIKE_MANAGER_CONTRACT]: managerAddress,
        },
      })),
      host,
      camURI: camDocumentURI,
      cam: parseCam(camJson),
      loadResource: createResourceLoader({
        [uiAbiURI]: encodeJson([{ name: BIKE_VIEW_ENTRY }]),
        [managerAbiURI]: encodeJson(managerAbi),
      }),
    }),
    (error) => error instanceof CamEvmError && error.code === "CAM_ABI_INVALID",
  )
})

test("callCamRoute orders named args by ABI and returns normalized route values", async () => {
  const publicClient = createPublicClient(publicClientFixtureOptions({
    routeResults: bikeRouteResults(BIKE_SERIAL_NUMBER, userAddress),
  }))

  const result = await callCamRoute({
    publicClient,
    cam: parseCam(camJson),
    contracts: {
      [BIKE_UI_NAMESPACE]: {
        address: uiAddress,
        abi: uiAbi,
      },
    },
    route: BIKE_ROUTE_COMPONENT,
    context: {
      host,
      account: { address: userAddress },
      inputs: {
        serialNumber: BIKE_SERIAL_NUMBER,
      },
      outputs: [],
      form: {},
    },
  })

  assert.equal(publicClient.calls.at(-1)?.functionName, BIKE_VIEW_COMPONENT)
  assert.deepEqual(publicClient.calls.at(-1)?.args, [BIKE_SERIAL_NUMBER, userAddress])
  assert.deepEqual(result.values[0], toInertValue({
    viewId: "component.found",
    actions: ["markComponentMissing"],
    account: userAddress,
    canRegister: true,
    accountInfo: "Mock registrar account",
    exists: true,
    serialHash: "0x1111111111111111111111111111111111111111111111111111111111111111",
    tokenContract: "0x0000000000000000000000000000000000000010",
    tokenId: "42",
    owner: userAddress,
    ownerInfo: "Mock owner account",
    registrar: userAddress,
    status: "1",
    tokenURI: `ipfs://example/token/${BIKE_SERIAL_NUMBER}`,
    registeredAt: "1",
    updatedAt: "2",
    serialNumber: BIKE_SERIAL_NUMBER,
    permissions: "7",
    isOwner: true,
    canUpdateMetadata: true,
    canMarkMissing: true,
    canClearMissing: false,
    canRetire: true,
    componentsAddress: "0x0000000000000000000000000000000000000010",
  }))
})

test("callCamRoute rejects mutable route functions and invalid named args", async () => {
  const nonViewAbi = [
    {
      ...findAbiFunction(uiAbi, BIKE_VIEW_ENTRY),
      stateMutability: "nonpayable",
    },
  ] as const satisfies Abi

  await assert.rejects(
    () => callCamRoute({
      publicClient: createPublicClient(publicClientFixtureOptions({})),
      cam: parseCam(camJson),
      contracts: {
        [BIKE_UI_NAMESPACE]: {
          address: uiAddress,
          abi: nonViewAbi,
        },
      },
      route: BIKE_ROUTE_ENTRY,
      context: {
        host,
        account: { address: userAddress },
        inputs: {},
        outputs: [],
        form: {},
      },
    }),
    (error) => error instanceof CamEvmError && error.code === "CAM_ROUTE_FUNCTION_NOT_VIEW",
  )

  await assert.rejects(
    () => callCamRoute({
      publicClient: createPublicClient(publicClientFixtureOptions({})),
      cam: parseCam({
        ...camJson,
        routes: {
          ...camJson.routes,
          entry: {
            ...camJson.routes.entry,
            call: {
              ...camJson.routes.entry.call,
              args: {
                extra: "x",
              },
            },
          },
        },
      }),
      contracts: {
        [BIKE_UI_NAMESPACE]: {
          address: uiAddress,
          abi: uiAbi,
        },
      },
      route: BIKE_ROUTE_ENTRY,
      context: {
        host,
        account: { address: userAddress },
        inputs: {},
        outputs: [],
        form: {},
      },
    }),
    (error) => error instanceof CamEvmError && error.code === "CAM_ROUTE_INVALID_ARGUMENT",
  )
})

test("sendCamContractCall and simulateCamContractCall validate named write args", async () => {
  const walletClient = createWalletClient()

  const hash = await sendCamContractCall({
    walletClient,
    call: {
      address: managerAddress,
      abi: managerAbi,
      function: BIKE_MARK_MISSING,
      args: {
        serialNumber: BIKE_SERIAL_NUMBER,
      },
    },
  })

  assert.equal(hash, "0x1234")
  assert.deepEqual(walletClient.calls, [
    {
      address: managerAddress,
      abi: managerAbi,
      functionName: BIKE_MARK_MISSING,
      args: [BIKE_SERIAL_NUMBER],
      chain: null,
    },
  ])

  await assert.rejects(
    () => sendCamContractCall({
      walletClient,
      call: {
        address: managerAddress,
        abi: managerAbi,
        function: BIKE_MARK_MISSING,
        args: {},
      },
    }),
    (error) => error instanceof CamEvmError && error.code === "CAM_WRITE_INVALID_ARGUMENT",
  )

  const publicClient = createSimulationClient()
  await simulateCamContractCall({
    publicClient,
    account: userAddress,
    call: {
      address: managerAddress,
      abi: managerAbi,
      function: BIKE_MARK_MISSING,
      args: {
        serialNumber: BIKE_SERIAL_NUMBER,
      },
    },
  })

  assert.deepEqual(publicClient.calls, [
    {
      address: managerAddress,
      abi: managerAbi,
      functionName: BIKE_MARK_MISSING,
      args: [BIKE_SERIAL_NUMBER],
      account: userAddress,
    },
  ])
})

function createPublicClient({
  camURI,
  camHash,
  addresses,
  routeResults,
}: PublicClientFixtureOptions) {
  // This fake models raw viem return values before callCamRoute normalizes
  // them to RouteResult.values.
  return createMockCamPublicClient<CamPublicClient["readContract"]>({
    camURI,
    camHash,
    addresses,
    routeResults,
  })
}

type PublicClientFixtureOptions = {
  readonly camURI: string
  readonly camHash: Hex
  readonly addresses: Record<string, Address>
  readonly routeResults: Record<string, unknown>
}

function publicClientFixtureOptions(overrides: Partial<PublicClientFixtureOptions>): PublicClientFixtureOptions {
  return {
    camURI: camDocumentURI,
    camHash: BIKE_UNSIGNED_CAM_HASH,
    addresses: bikeContractAddresses,
    routeResults: NO_ROUTE_RESULTS,
    ...overrides,
  }
}

function createSimulationClient(failure?: Error): CamSimulationClient & {
  readonly calls: Array<{
    readonly address: Address
    readonly abi: Abi
    readonly functionName: string
    readonly args?: readonly unknown[]
    readonly account: Address
  }>
} {
  const calls: Array<{
    readonly address: Address
    readonly abi: Abi
    readonly functionName: string
    readonly args?: readonly unknown[]
    readonly account: Address
  }> = []

  return {
    calls,
    async simulateContract(request) {
      calls.push(request)
      if (failure !== undefined) {
        throw failure
      }
    },
  }
}

function createWalletClient(): CamWalletClient & {
  readonly calls: Array<{
    readonly address: Address
    readonly abi: Abi
    readonly functionName: string
    readonly args?: readonly unknown[]
    readonly chain: null
  }>
} {
  const calls: Array<{
    readonly address: Address
    readonly abi: Abi
    readonly functionName: string
    readonly args?: readonly unknown[]
    readonly chain: null
  }> = []

  return {
    calls,
    async writeContract(request) {
      calls.push(request)
      return "0x1234"
    },
  }
}

type AbiFunctionItem = Extract<Abi[number], { readonly type: "function" }>

function findAbiFunction(abi: Abi, functionName: string): AbiFunctionItem {
  const item = abi.find((candidate): candidate is AbiFunctionItem => (
    candidate.type === "function" && candidate.name === functionName
  ))
  if (item === undefined) {
    throw new Error(`missing ABI function fixture: ${functionName}`)
  }

  return item
}
