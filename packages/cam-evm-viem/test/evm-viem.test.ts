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
} from "../src/index.ts"
import type { CamHost, CamPublicClient } from "../src/index.ts"
import {
  BIKE_ACCOUNT_ADDRESS as userAddress,
  BIKE_CAM_URI as camDocumentURI,
  BIKE_ENTRY_SCREEN_URI,
  BIKE_MANAGER_ABI_URI as managerAbiURI,
  BIKE_MANAGER_ADDRESS as managerAddress,
  BIKE_MANAGER_CONTRACT,
  BIKE_RELATIVE_ENTRY_SCREEN_URI,
  BIKE_RELATIVE_MANAGER_ABI_URI,
  BIKE_ROUTE_ENTRY,
  BIKE_SERIAL_NUMBER,
  BIKE_UNSIGNED_CAM_HASH,
  BIKE_UI_ABI_URI as uiAbiURI,
  BIKE_UI_ADDRESS as uiAddress,
  BIKE_UI_CONTRACT,
  BIKE_VIEW_ENTRY,
  bikeCamJson as camJson,
  bikeContractAddresses,
  bikeHost,
  bikeManagerAbi as managerAbi,
  bikeRouteResults,
  bikeUiAbi as uiAbi,
} from "../../../tests/fixtures/cam/bike.mts"
import {
  createMockCamPublicClient,
  createMockResourceLoader as createResourceLoader,
  encodeJson,
  encodeText,
} from "../../../tests/fixtures/cam/mock.mts"

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
      [BIKE_VIEW_ENTRY]: [BIKE_RELATIVE_ENTRY_SCREEN_URI, 7n, { count: 8n }],
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
    "7",
    toInertValue({ count: "8" }),
  ])

  assert.deepEqual(publicClient.calls.at(-1), {
    address: uiAddress,
    abi: uiAbi,
    functionName: BIKE_VIEW_ENTRY,
    args: [userAddress],
    account: userAddress,
  })
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
