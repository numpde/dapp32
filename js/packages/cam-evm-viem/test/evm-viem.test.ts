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
  BIKE_COMPONENTS_ADDRESS,
  BIKE_ENTRY_SCREEN_URI,
  BIKE_MANAGER_ABI_URI as managerAbiURI,
  BIKE_MANAGER_ADDRESS as managerAddress,
  BIKE_MANAGER_CONTRACT,
  BIKE_RELATIVE_ENTRY_SCREEN_URI,
  BIKE_RELATIVE_MANAGER_ABI_URI,
  BIKE_RELATIVE_REGISTER_READY_SCREEN_URI,
  BIKE_ROUTE_ENTRY,
  BIKE_ROUTE_REGISTER,
  BIKE_SERIAL_NUMBER,
  BIKE_UNSIGNED_CAM_HASH,
  BIKE_MARK_MISSING,
  BIKE_UI_ABI_URI as uiAbiURI,
  BIKE_UI_ADDRESS as uiAddress,
  BIKE_UI_CONTRACT,
  BIKE_VIEW_ENTRY,
  BIKE_VIEW_REGISTER,
  bikeCamJson as camJson,
  bikeContractAddresses,
  bikeHost,
  bikeManagerAbi as managerAbi,
  bikeRouteResults,
  bikeUiAbi as uiAbi,
} from "../../../../tests/fixtures/cam/bike.mts"
import {
  createMockCamPublicClient,
  createMockResourceLoader as createResourceLoader,
  encodeJson,
  encodeText,
} from "../../../../tests/fixtures/cam/mock.mts"

const host: CamHost = bikeHost
const ROOT_CAM_URI = "camURI"
const ROOT_CAM_HASH = "camHash"
const ROOT_CONTRACT_ADDRESS = "contractAddress"

test("loadCamFromHost reads root metadata, accepts unsigned CAMs, and rejects hash mismatches", async () => {
  const camBytes = encodeJson(camJson)
  const publicClient = createPublicClient({
    camURI: camDocumentURI,
    camHash: BIKE_UNSIGNED_CAM_HASH,
  })
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
      publicClient: createPublicClient({
        camURI: camDocumentURI,
        camHash: "0x1111111111111111111111111111111111111111111111111111111111111111",
      }),
      host,
      loadResource: resources,
      allowUnsignedCamHash: false,
    }),
    (error) => error instanceof CamEvmError && error.code === "CAM_HASH_MISMATCH",
  )
})

test("resolveCamContracts resolves addresses through CamRoot and ABI URIs relative to the CAM", async () => {
  const cam = parseCam(camJson)
  const publicClient = createPublicClient({
    addresses: {
      [BIKE_UI_CONTRACT]: uiAddress,
      [BIKE_MANAGER_CONTRACT]: managerAddress,
    },
  })
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

  assert.equal(contracts[BIKE_UI_CONTRACT].address, uiAddress)
  assert.deepEqual(contracts[BIKE_UI_CONTRACT].abi, uiAbi)
  assert.equal(Object.getPrototypeOf(contracts), null)
})

test("callCamRoute resolves CAM args, calls the selected contract, and returns normalized route values", async () => {
  const cam = parseCam(camJson)
  const publicClient = createPublicClient({
    routeResults: {
      [BIKE_VIEW_ENTRY]: [BIKE_RELATIVE_ENTRY_SCREEN_URI, [userAddress, true, "Mock registrar account"]],
    },
  })

  const result = await callCamRoute({
    publicClient,
    cam,
    camURI: camDocumentURI,
    contracts: {
      [BIKE_UI_CONTRACT]: {
        address: uiAddress,
        abi: uiAbi,
      },
    },
    route: BIKE_ROUTE_ENTRY,
    context: {
      host,
      account: { address: userAddress },
      params: {},
    },
  })

  assert.equal(result.screenURI, BIKE_ENTRY_SCREEN_URI)
  assert.deepEqual(result.values, [
    toInertValue({
      account: userAddress,
      canRegister: true,
      accountInfo: "Mock registrar account",
    }),
  ])

  assert.deepEqual(publicClient.calls.at(-1), {
    address: uiAddress,
    abi: uiAbi,
    functionName: BIKE_VIEW_ENTRY,
    args: [userAddress],
    account: userAddress,
  })
})

test("callCamRoute maps positional ABI tuples to named route values", async () => {
  const cam = parseCam(camJson)
  const publicClient = createPublicClient({
    routeResults: {
      [BIKE_VIEW_REGISTER]: [
        BIKE_RELATIVE_REGISTER_READY_SCREEN_URI,
        [
          true,
          false,
          "0x2222222222222222222222222222222222222222222222222222222222222222",
          0n,
          BIKE_COMPONENTS_ADDRESS,
          BIKE_SERIAL_NUMBER,
          "Mock registrar account",
        ],
        [
          userAddress,
          true,
          "Mock registrar account",
        ],
      ],
    },
  })

  const result = await callCamRoute({
    publicClient,
    cam,
    camURI: camDocumentURI,
    contracts: {
      [BIKE_UI_CONTRACT]: {
        address: uiAddress,
        abi: uiAbi,
      },
    },
    route: BIKE_ROUTE_REGISTER,
    context: {
      host,
      account: { address: userAddress },
      params: {
        serialNumber: BIKE_SERIAL_NUMBER,
      },
    },
  })

  assert.deepEqual(result.values, [
    toInertValue({
      canRegister: true,
      exists: false,
      serialHash: "0x2222222222222222222222222222222222222222222222222222222222222222",
      tokenId: "0",
      componentsAddress: BIKE_COMPONENTS_ADDRESS,
      serialNumber: BIKE_SERIAL_NUMBER,
      accountInfo: "Mock registrar account",
    }),
    toInertValue({
      account: userAddress,
      canRegister: true,
      accountInfo: "Mock registrar account",
    }),
  ])
})

test("callCamRoute rejects unsafe screen URIs and non-view route functions", async () => {
  const unsafeScreenURIs = [
    "",
    "https://example.com/x.json",
    "ipfs://example/x.json",
    "../x.json",
    BIKE_RELATIVE_MANAGER_ABI_URI,
    "./screens/../x.json",
    "/screens/component.json",
  ]

  for (const unsafeScreenURI of unsafeScreenURIs) {
    await assert.rejects(
      () => callCamRoute({
        publicClient: createPublicClient({
          routeResults: {
            [BIKE_VIEW_ENTRY]: [unsafeScreenURI],
          },
        }),
        cam: parseCam(camJson),
        camURI: camDocumentURI,
        contracts: {
          [BIKE_UI_CONTRACT]: {
            address: uiAddress,
            abi: uiAbi,
          },
        },
        route: BIKE_ROUTE_ENTRY,
        context: {
          host,
          account: { address: userAddress },
          params: {},
        },
      }),
      (error) => error instanceof CamEvmError && error.code === "CAM_ROUTE_INVALID_RESULT",
    )
  }

  const nonViewAbi = [
    {
      ...uiAbi[0],
      stateMutability: "nonpayable",
    },
  ] as const satisfies Abi

  await assert.rejects(
    () => callCamRoute({
      publicClient: createPublicClient({
        routeResults: {
          [BIKE_VIEW_ENTRY]: [BIKE_RELATIVE_ENTRY_SCREEN_URI],
        },
      }),
      cam: parseCam(camJson),
      camURI: camDocumentURI,
      contracts: {
        [BIKE_UI_CONTRACT]: {
          address: uiAddress,
          abi: nonViewAbi,
        },
      },
      route: BIKE_ROUTE_ENTRY,
      context: {
        host,
        account: { address: userAddress },
        params: {},
      },
    }),
    (error) => error instanceof CamEvmError && error.code === "CAM_ROUTE_FUNCTION_NOT_VIEW",
  )
})

test("callCamRoute rejects route return values that do not match the ABI", async () => {
  await assert.rejects(
    () => callCamRoute({
      publicClient: createPublicClient({
        routeResults: {
          [BIKE_VIEW_ENTRY]: [BIKE_RELATIVE_ENTRY_SCREEN_URI],
        },
      }),
      cam: parseCam(camJson),
      camURI: camDocumentURI,
      contracts: {
        [BIKE_UI_CONTRACT]: {
          address: uiAddress,
          abi: uiAbi,
        },
      },
      route: BIKE_ROUTE_ENTRY,
      context: {
        host,
        account: { address: userAddress },
        params: {},
      },
    }),
    (error) => error instanceof CamEvmError && error.code === "CAM_ROUTE_INVALID_RESULT",
  )

  await assert.rejects(
    () => callCamRoute({
      publicClient: createPublicClient({
        routeResults: {
          [BIKE_VIEW_ENTRY]: [BIKE_RELATIVE_ENTRY_SCREEN_URI, [userAddress, true, ""], "extra"],
        },
      }),
      cam: parseCam(camJson),
      camURI: camDocumentURI,
      contracts: {
        [BIKE_UI_CONTRACT]: {
          address: uiAddress,
          abi: uiAbi,
        },
      },
      route: BIKE_ROUTE_ENTRY,
      context: {
        host,
        account: { address: userAddress },
        params: {},
      },
    }),
    (error) => error instanceof CamEvmError && error.code === "CAM_ROUTE_INVALID_RESULT",
  )
})

test("sendCamContractCall validates mutable ABI functions and submits through the wallet client", async () => {
  const walletClient = createWalletClient()

  const hash = await sendCamContractCall({
    walletClient,
    call: {
      address: managerAddress,
      abi: managerAbi,
      function: BIKE_MARK_MISSING,
      args: [BIKE_SERIAL_NUMBER],
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
        address: uiAddress,
        abi: uiAbi,
        function: BIKE_VIEW_ENTRY,
        args: [userAddress],
      },
    }),
    (error) => error instanceof CamEvmError && error.code === "CAM_WRITE_FUNCTION_NOT_MUTABLE",
  )

  await assert.rejects(
    () => sendCamContractCall({
      walletClient,
      call: {
        address: managerAddress,
        abi: [{
          type: "function",
          name: "setCount",
          stateMutability: "nonpayable",
          inputs: [{ name: "count", type: "uint256" }],
          outputs: [],
        }],
        function: "setCount",
        args: [-1],
      },
    }),
    (error) => error instanceof CamEvmError && error.code === "CAM_WRITE_INVALID_ARGUMENT",
  )

  await assert.rejects(
    () => sendCamContractCall({
      walletClient,
      call: {
        address: managerAddress,
        abi: [{
          type: "function",
          name: "setTag",
          stateMutability: "nonpayable",
          inputs: [{ name: "tag", type: "bytes4" }],
          outputs: [],
        }],
        function: "setTag",
        args: ["0x123456"],
      },
    }),
    (error) => error instanceof CamEvmError && error.code === "CAM_WRITE_INVALID_ARGUMENT",
  )

  await assert.rejects(
    () => sendCamContractCall({
      walletClient,
      call: {
        address: managerAddress,
        abi: [{
          type: "function",
          name: "missingInputs",
          stateMutability: "nonpayable",
        }] as unknown as Abi,
        function: "missingInputs",
        args: [],
      },
    }),
    (error) => error instanceof CamEvmError && error.code === "CAM_WRITE_INVALID_ARGUMENT",
  )
})

test("simulateCamContractCall validates and simulates with the selected account", async () => {
  const publicClient = createSimulationClient()

  await simulateCamContractCall({
    publicClient,
    account: userAddress,
    call: {
      address: managerAddress,
      abi: managerAbi,
      function: BIKE_MARK_MISSING,
      args: [BIKE_SERIAL_NUMBER],
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

  const failingClient = createSimulationClient(new Error("EmptySerialNumber()"))

  await assert.rejects(
    () => simulateCamContractCall({
      publicClient: failingClient,
      account: userAddress,
      call: {
        address: managerAddress,
        abi: managerAbi,
        function: BIKE_MARK_MISSING,
        args: [BIKE_SERIAL_NUMBER],
      },
    }),
    (error) => error instanceof CamEvmError && error.code === "CAM_WRITE_SIMULATION_FAILED",
  )
})

function createPublicClient({
  // These defaults are fixture conveniences. Tests exercising host metadata,
  // bindings, or route returns override the relevant field explicitly.
  camURI = camDocumentURI,
  camHash = BIKE_UNSIGNED_CAM_HASH,
  addresses = bikeContractAddresses,
  routeResults = {},
}: {
  readonly camURI?: string
  readonly camHash?: Hex
  readonly addresses?: Record<string, Address>
  readonly routeResults?: Record<string, unknown>
}) {
  // This fake models raw viem return values before callCamRoute normalizes
  // them to RouteResult.values.
  return createMockCamPublicClient<CamPublicClient["readContract"]>({
    camURI,
    camHash,
    addresses,
    routeResults,
    hostAddress: host.address,
  })
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
