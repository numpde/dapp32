import assert from "node:assert/strict"
import test from "node:test"
import { TextEncoder } from "node:util"

import { parseCam, toInertValue } from "@cam/core"
import type { Abi, Address, Hex } from "viem"

import * as camEvmViem from "../src/index.ts"
import {
  CamEvmError,
  callCamRoute,
  loadCamFromHost,
  resolveCamContracts,
  verifyCamHash,
} from "../src/index.ts"
import type { CamHost, CamPublicClient, ResourceLoader } from "../src/index.ts"
import {
  BIKE_ACCOUNT_ADDRESS as userAddress,
  BIKE_CAM_URI as camDocumentURI,
  BIKE_COMPONENT_SCREEN_URI,
  BIKE_ENTRY_SCREEN_URI,
  BIKE_MANAGER_ABI_URI as managerAbiURI,
  BIKE_MANAGER_ADDRESS as managerAddress,
  BIKE_MANAGER_CONTRACT,
  BIKE_REGISTER_SCREEN_URI,
  BIKE_RELATIVE_ENTRY_SCREEN_URI,
  BIKE_RELATIVE_MANAGER_ABI_URI,
  BIKE_ROUTE_COMPONENT,
  BIKE_ROUTE_ENTRY,
  BIKE_ROUTE_REGISTER,
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

const host: CamHost = bikeHost
const ROOT_CAM_URI = "camURI"
const ROOT_CAM_HASH = "camHash"
const ROOT_CONTRACT_ADDRESS = "contractAddress"
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000"

test("keeps the public API to the CAM EVM viem adapter boundary", () => {
  assert.deepEqual(Object.keys(camEvmViem).sort(), [
    "CamEvmError",
    "callCamRoute",
    "loadCamFromHost",
    "resolveCamContracts",
    "verifyCamHash",
  ])
})

test("loadCamFromHost reads root metadata and accepts bytes32(0) as an unsigned CAM", async () => {
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
  })

  assert.equal(loaded.camURI, camDocumentURI)
  assert.deepEqual(loaded.cam, parseCam(camJson))
  assert.deepEqual(publicClient.calls.map((call) => call.functionName), [
    ROOT_CAM_URI,
    ROOT_CAM_HASH,
  ])
})

test("verifyCamHash rejects mismatched nonzero hashes", () => {
  assert.throws(
    () => verifyCamHash({
      bytes: encodeText("not this hash"),
      expectedHash: "0x1111111111111111111111111111111111111111111111111111111111111111",
    }),
    (error) => error instanceof CamEvmError && error.code === "CAM_HASH_MISMATCH",
  )
})

test("verifyCamHash requires explicit unsigned mode for bytes32(0)", () => {
  assert.throws(
    () => verifyCamHash({
      bytes: encodeText("unsigned CAM"),
      expectedHash: BIKE_UNSIGNED_CAM_HASH,
    }),
    (error) => error instanceof CamEvmError && error.code === "CAM_HASH_UNSIGNED",
  )

  assert.doesNotThrow(() => verifyCamHash({
    bytes: encodeText("unsigned CAM"),
    expectedHash: BIKE_UNSIGNED_CAM_HASH.toUpperCase() as Hex,
    allowUnsigned: true,
  }))
})

test("loadCamFromHost wraps invalid CAM JSON in an adapter error", async () => {
  await assert.rejects(
    () => loadCamFromHost({
      publicClient: createPublicClient({
        camURI: camDocumentURI,
        camHash: BIKE_UNSIGNED_CAM_HASH,
      }),
      host,
      loadResource: createResourceLoader({
        [camDocumentURI]: encodeText("{not json"),
      }),
    }),
    (error) => error instanceof CamEvmError && error.code === "CAM_DOCUMENT_INVALID",
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
  assert.equal(contracts[BIKE_MANAGER_CONTRACT].address, managerAddress)
})

test("resolveCamContracts rejects unbound contract names", async () => {
  await assert.rejects(
    () => resolveCamContracts({
      publicClient: createPublicClient({
        addresses: {
          [BIKE_UI_CONTRACT]: uiAddress,
        },
      }),
      host,
      camURI: camDocumentURI,
      cam: parseCam(camJson),
      loadResource: createResourceLoader({}),
    }),
    (error) => error instanceof CamEvmError && error.code === "CAM_CONTRACT_UNBOUND",
  )
})

test("resolveCamContracts rejects invalid ABI JSON", async () => {
  await assert.rejects(
    () => resolveCamContracts({
      publicClient: createPublicClient({
        addresses: {
          [BIKE_UI_CONTRACT]: uiAddress,
          [BIKE_MANAGER_CONTRACT]: managerAddress,
        },
      }),
      host,
      camURI: camDocumentURI,
      cam: parseCam(camJson),
      loadResource: createResourceLoader({
        [uiAbiURI]: encodeText("{not json"),
        [managerAbiURI]: encodeJson(managerAbi),
      }),
    }),
    (error) => error instanceof CamEvmError && error.code === "CAM_ABI_INVALID",
  )
})

test("resolveCamContracts rejects ABI JSON that is not an array", async () => {
  await assert.rejects(
    () => resolveCamContracts({
      publicClient: createPublicClient({
        addresses: {
          [BIKE_UI_CONTRACT]: uiAddress,
          [BIKE_MANAGER_CONTRACT]: managerAddress,
        },
      }),
      host,
      camURI: camDocumentURI,
      cam: parseCam(camJson),
      loadResource: createResourceLoader({
        [uiAbiURI]: encodeJson({ abi: uiAbi }),
        [managerAbiURI]: encodeJson(managerAbi),
      }),
    }),
    (error) => error instanceof CamEvmError && error.code === "CAM_ABI_INVALID",
  )
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

test("callCamRoute requires the first route return value to be a non-empty screen URI", async () => {
  await assert.rejects(
    () => callCamRoute({
      publicClient: createPublicClient({
        routeResults: {
          [BIKE_VIEW_ENTRY]: "",
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

test("callCamRoute validates account addresses before calling viem", async () => {
  const publicClient = createPublicClient({
    routeResults: {
      [BIKE_VIEW_ENTRY]: [BIKE_RELATIVE_ENTRY_SCREEN_URI],
    },
  })

  await assert.rejects(
    () => callCamRoute({
      publicClient,
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
        account: { address: "not-an-address" },
        params: {},
      },
    }),
    (error) => error instanceof CamEvmError && error.code === "CAM_INVALID_ACCOUNT",
  )

  assert.equal(publicClient.calls.length, 0)
})

test("callCamRoute accepts only CAM-local screen JSON resources", async () => {
  const unsafeScreenURIs = [
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
})

test("bike CAM routes resolve to the three route-level screens", async () => {
  const cam = parseCam(camJson)
  const routeResults = bikeRouteResults(BIKE_SERIAL_NUMBER, userAddress)

  for (const [route, expectedScreenURI] of [
    [BIKE_ROUTE_ENTRY, BIKE_ENTRY_SCREEN_URI],
    [BIKE_ROUTE_COMPONENT, BIKE_COMPONENT_SCREEN_URI],
    [BIKE_ROUTE_REGISTER, BIKE_REGISTER_SCREEN_URI],
  ] as const) {
    const result = await callCamRoute({
      publicClient: createPublicClient({ routeResults }),
      cam,
      camURI: camDocumentURI,
      contracts: {
        [BIKE_UI_CONTRACT]: {
          address: uiAddress,
          abi: uiAbi,
        },
      },
      route,
      context: {
        host,
        account: { address: userAddress },
        params: { serialNumber: BIKE_SERIAL_NUMBER },
      },
    })

    assert.equal(result.screenURI, expectedScreenURI)
  }
})

test("callCamRoute rejects route functions missing from the resolved ABI", async () => {
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
          abi: managerAbi,
        },
      },
      route: BIKE_ROUTE_ENTRY,
      context: {
        host,
        account: { address: userAddress },
        params: {},
      },
    }),
    (error) => error instanceof CamEvmError && error.code === "CAM_ROUTE_FUNCTION_NOT_FOUND",
  )
})

test("callCamRoute rejects route functions that are not view or pure", async () => {
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

test("callCamRoute rejects overloaded route function names in CAM V1", async () => {
  const overloadedAbi = [
    uiAbi[0],
    {
      ...uiAbi[0],
      inputs: [],
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
          abi: overloadedAbi,
        },
      },
      route: BIKE_ROUTE_ENTRY,
      context: {
        host,
        account: { address: userAddress },
        params: {},
      },
    }),
    (error) => error instanceof CamEvmError && error.code === "CAM_ROUTE_FUNCTION_AMBIGUOUS",
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
  // This fake models raw viem return values before callCamRoute normalizes
  // them to RouteResult.values.
  readonly routeResults?: Record<string, unknown>
}) {
  const calls: Array<{
    readonly address: Address
    readonly abi?: Abi
    readonly functionName: string
    readonly args?: readonly unknown[]
    readonly account?: Address
  }> = []

  async function readContract(request: {
    readonly address: Address
    readonly abi?: Abi
    readonly functionName: string
    readonly args?: readonly unknown[]
    readonly account?: Address
  }): Promise<unknown> {
    calls.push(request)

    if (request.functionName === ROOT_CAM_URI) {
      return camURI
    }

    if (request.functionName === ROOT_CAM_HASH) {
      return camHash
    }

    if (request.functionName === ROOT_CONTRACT_ADDRESS) {
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
    readContract: readContract as CamPublicClient["readContract"],
  }
}

function requireContractName(args: readonly unknown[] | undefined): string {
  if (args?.length !== 1 || typeof args[0] !== "string") {
    throw new Error("contractAddress expected one string argument")
  }

  return args[0]
}

function createResourceLoader(resources: Record<string, Uint8Array>): ResourceLoader {
  return async (uri) => {
    const bytes = resources[uri]
    if (bytes === undefined) {
      throw new Error(`unexpected resource URI: ${uri}`)
    }

    return bytes
  }
}

function encodeJson(value: unknown): Uint8Array {
  return encodeText(JSON.stringify(value))
}

function encodeText(value: string): Uint8Array {
  return new TextEncoder().encode(value)
}
