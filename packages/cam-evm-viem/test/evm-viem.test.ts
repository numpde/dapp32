import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"
import { TextEncoder } from "node:util"

import { parseCam } from "@cam/core"
import { parseScreen, resolveScreen } from "@cam/screen"
import type { Abi, Address, Hex } from "viem"

import {
  CamEvmError,
  callCamRoute,
  loadCamFromHost,
  resolveCamContracts,
  verifyCamHash,
  ZERO_HASH,
} from "../src/index.ts"
import { CAM_ROOT_FUNCTIONS } from "../src/abi.ts"
import { ZERO_ADDRESS } from "../src/constants.ts"
import type { CamHost, ResourceLoader } from "../src/index.ts"

const host: CamHost = {
  chainId: "eip155:31337",
  address: "0x0000000000000000000000000000000000000001",
}

const userAddress = "0x0000000000000000000000000000000000000002"
const uiAddress = "0x0000000000000000000000000000000000000003"
const managerAddress = "0x0000000000000000000000000000000000000004"
const camDocumentURI = "ipfs://example/main.json"
const uiAbiURI = "ipfs://example/abi/BicycleComponentManagerUI.json"
const managerAbiURI = "ipfs://example/abi/BicycleComponentManager.json"

const camJson = {
  cam: "1.0.0",
  entry: "entry",
  contracts: {
    BicycleComponentManagerUI: {
      abiURI: "./abi/BicycleComponentManagerUI.json",
    },
    BicycleComponentManager: {
      abiURI: "./abi/BicycleComponentManager.json",
    },
  },
  routes: {
    entry: {
      contract: "BicycleComponentManagerUI",
      function: "viewEntry",
      args: ["$account.address"],
    },
    component: {
      contract: "BicycleComponentManagerUI",
      function: "viewComponent",
      args: ["$params.serialNumber", "$account.address"],
    },
    register: {
      contract: "BicycleComponentManagerUI",
      function: "viewRegister",
      args: ["$params.serialNumber", "$account.address"],
    },
  },
}

const uiAbi = [
  {
    type: "function",
    name: "viewEntry",
    stateMutability: "view",
    inputs: [{ name: "viewer", type: "address" }],
    outputs: [
      { name: "screenURI", type: "string" },
      { name: "componentCount", type: "uint256" },
    ],
  },
  {
    type: "function",
    name: "viewComponent",
    stateMutability: "view",
    inputs: [
      { name: "serialNumber", type: "string" },
      { name: "viewer", type: "address" },
    ],
    outputs: [{ name: "screenURI", type: "string" }],
  },
  {
    type: "function",
    name: "viewRegister",
    stateMutability: "view",
    inputs: [
      { name: "serialNumber", type: "string" },
      { name: "viewer", type: "address" },
    ],
    outputs: [{ name: "screenURI", type: "string" }],
  },
] as const satisfies Abi

const managerAbi = [] as const satisfies Abi

test("loadCamFromHost reads root metadata and accepts bytes32(0) as an unsigned CAM", async () => {
  const camBytes = encodeJson(camJson)
  const publicClient = createPublicClient({
    camURI: camDocumentURI,
    camHash: ZERO_HASH,
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
  assert.equal(loaded.camHash, ZERO_HASH)
  assert.deepEqual(loaded.cam, parseCam(camJson))
  assert.deepEqual(publicClient.calls.map((call) => call.functionName), [
    CAM_ROOT_FUNCTIONS.camURI,
    CAM_ROOT_FUNCTIONS.camHash,
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

test("verifyCamHash treats any casing of bytes32(0) as unsigned", () => {
  assert.doesNotThrow(() => verifyCamHash({
    bytes: encodeText("unsigned CAM"),
    expectedHash: ZERO_HASH.toUpperCase() as Hex,
  }))
})

test("loadCamFromHost wraps invalid CAM JSON in an adapter error", async () => {
  await assert.rejects(
    () => loadCamFromHost({
      publicClient: createPublicClient({
        camURI: camDocumentURI,
        camHash: ZERO_HASH,
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
      BicycleComponentManagerUI: uiAddress,
      BicycleComponentManager: managerAddress,
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

  assert.equal(contracts.BicycleComponentManagerUI.address, uiAddress)
  assert.equal(contracts.BicycleComponentManagerUI.abiURI, uiAbiURI)
  assert.deepEqual(contracts.BicycleComponentManagerUI.abi, uiAbi)
  assert.equal(contracts.BicycleComponentManager.address, managerAddress)
})

test("resolveCamContracts rejects unbound contract names", async () => {
  await assert.rejects(
    () => resolveCamContracts({
      publicClient: createPublicClient({
        addresses: {
          BicycleComponentManagerUI: uiAddress,
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
          BicycleComponentManagerUI: uiAddress,
          BicycleComponentManager: managerAddress,
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
          BicycleComponentManagerUI: uiAddress,
          BicycleComponentManager: managerAddress,
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
      viewEntry: ["./screens/entry.json", BigInt(7)],
    },
  })

  const result = await callCamRoute({
    publicClient,
    cam,
    camURI: camDocumentURI,
    contracts: {
      BicycleComponentManagerUI: {
        address: uiAddress,
        abiURI: uiAbiURI,
        abi: uiAbi,
      },
    },
    route: "entry",
    context: {
      host,
      account: { address: userAddress },
      params: {},
    },
  })

  assert.equal(result.screenURI, "ipfs://example/screens/entry.json")
  assert.deepEqual(result.values, ["./screens/entry.json", BigInt(7)])

  assert.deepEqual(publicClient.calls.at(-1), {
    address: uiAddress,
    abi: uiAbi,
    functionName: "viewEntry",
    args: [userAddress],
    account: userAddress,
  })
})

test("callCamRoute requires the first route return value to be a non-empty screen URI", async () => {
  await assert.rejects(
    () => callCamRoute({
      publicClient: createPublicClient({
        routeResults: {
          viewEntry: "",
        },
      }),
      cam: parseCam(camJson),
      camURI: camDocumentURI,
      contracts: {
        BicycleComponentManagerUI: {
          address: uiAddress,
          abiURI: uiAbiURI,
          abi: uiAbi,
        },
      },
      route: "entry",
      context: {
        host,
        account: { address: userAddress },
        params: {},
      },
    }),
    (error) => error instanceof CamEvmError && error.code === "CAM_ROUTE_INVALID_RESULT",
  )
})

test("callCamRoute accepts only CAM-local screen JSON resources", async () => {
  const unsafeScreenURIs = [
    "https://example.com/x.json",
    "ipfs://example/x.json",
    "../x.json",
    "./abi/BicycleComponentManager.json",
    "./screens/../x.json",
    "/screens/component.json",
  ]

  for (const unsafeScreenURI of unsafeScreenURIs) {
    await assert.rejects(
      () => callCamRoute({
        publicClient: createPublicClient({
          routeResults: {
            viewEntry: [unsafeScreenURI],
          },
        }),
        cam: parseCam(camJson),
        camURI: camDocumentURI,
        contracts: {
          BicycleComponentManagerUI: {
            address: uiAddress,
            abiURI: uiAbiURI,
            abi: uiAbi,
          },
        },
        route: "entry",
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
  const routeResults = {
    viewEntry: [
      "./screens/entry.json",
      {
        account: userAddress,
        canRegister: true,
        accountInfo: "registrar",
      },
    ],
    viewComponent: [
      "./screens/component.json",
      {
        exists: true,
        serialHash: "0x1111111111111111111111111111111111111111111111111111111111111111",
        tokenContract: "0x0000000000000000000000000000000000000010",
        tokenId: BigInt(42),
        owner: userAddress,
        ownerInfo: "owner",
        registrar: userAddress,
        status: 1,
        tokenURI: "ipfs://example/token/42",
        registeredAt: 1,
        updatedAt: 2,
        serialNumber: "ABC123",
        permissions: BigInt(7),
        isOwner: true,
        canUpdateMetadata: true,
        canMarkMissing: true,
        canClearMissing: false,
        canRetire: false,
      },
      {
        account: userAddress,
        canRegister: true,
        accountInfo: "registrar",
      },
    ],
    viewRegister: [
      "./screens/register.json",
      {
        canRegister: true,
        exists: false,
        serialHash: "0x2222222222222222222222222222222222222222222222222222222222222222",
        tokenId: BigInt(0),
        defaultComponents: "0x0000000000000000000000000000000000000020",
        serialNumber: "ABC123",
        accountInfo: "registrar",
      },
      {
        account: userAddress,
        canRegister: true,
        accountInfo: "registrar",
      },
    ],
  }

  for (const [route, expectedScreenURI] of [
    ["entry", "ipfs://example/screens/entry.json"],
    ["component", "ipfs://example/screens/component.json"],
    ["register", "ipfs://example/screens/register.json"],
  ] as const) {
    const result = await callCamRoute({
      publicClient: createPublicClient({ routeResults }),
      cam,
      camURI: camDocumentURI,
      contracts: {
        BicycleComponentManagerUI: {
          address: uiAddress,
          abiURI: uiAbiURI,
          abi: uiAbi,
        },
      },
      route,
      context: {
        host,
        account: { address: userAddress },
        params: { serialNumber: "ABC123" },
      },
    })

    assert.equal(result.screenURI, expectedScreenURI)

    const screen = parseScreen(JSON.parse(await readBikeScreen(route)))
    assert.doesNotThrow(() => resolveScreen(screen, {
      host,
      account: { address: userAddress },
      params: { serialNumber: "ABC123" },
      state: { serialNumber: "ABC123" },
      values: result.values,
    }))
  }
})

test("callCamRoute rejects route functions missing from the resolved ABI", async () => {
  await assert.rejects(
    () => callCamRoute({
      publicClient: createPublicClient({
        routeResults: {
          viewEntry: ["./screens/entry.json"],
        },
      }),
      cam: parseCam(camJson),
      camURI: camDocumentURI,
      contracts: {
        BicycleComponentManagerUI: {
          address: uiAddress,
          abiURI: uiAbiURI,
          abi: managerAbi,
        },
      },
      route: "entry",
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
          viewEntry: ["./screens/entry.json"],
        },
      }),
      cam: parseCam(camJson),
      camURI: camDocumentURI,
      contracts: {
        BicycleComponentManagerUI: {
          address: uiAddress,
          abiURI: uiAbiURI,
          abi: nonViewAbi,
        },
      },
      route: "entry",
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
          viewEntry: ["./screens/entry.json"],
        },
      }),
      cam: parseCam(camJson),
      camURI: camDocumentURI,
      contracts: {
        BicycleComponentManagerUI: {
          address: uiAddress,
          abiURI: uiAbiURI,
          abi: overloadedAbi,
        },
      },
      route: "entry",
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
  camURI = camDocumentURI,
  camHash = ZERO_HASH,
  addresses = {},
  routeResults = {},
}: {
  readonly camURI?: string
  readonly camHash?: Hex
  readonly addresses?: Record<string, Address>
  readonly routeResults?: Record<string, unknown>
}) {
  const calls: Array<{
    readonly address: Address
    readonly abi?: Abi
    readonly functionName: string
    readonly args?: readonly unknown[]
    readonly account?: Address
  }> = []

  return {
    calls,
    async readContract(request: {
      readonly address: Address
      readonly functionName: string
      readonly args?: readonly unknown[]
      readonly account?: Address
    }): Promise<unknown> {
      calls.push(request)

      if (request.functionName === CAM_ROOT_FUNCTIONS.camURI) {
        return camURI
      }

      if (request.functionName === CAM_ROOT_FUNCTIONS.camHash) {
        return camHash
      }

      if (request.functionName === CAM_ROOT_FUNCTIONS.contractAddress) {
        const [name] = request.args ?? []
        return typeof name === "string" && addresses[name] !== undefined
          ? addresses[name]
          : ZERO_ADDRESS
      }

      if (Object.hasOwn(routeResults, request.functionName)) {
        return routeResults[request.functionName]
      }

      throw new Error(`unexpected readContract call: ${request.functionName}`)
    },
  }
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

async function readBikeScreen(route: "entry" | "component" | "register"): Promise<string> {
  return await readFile(
    new URL(`../../../dapps/bike-nft/cam/screens/${route}.json`, import.meta.url),
    "utf8",
  )
}

function encodeJson(value: unknown): Uint8Array {
  return encodeText(JSON.stringify(value))
}

function encodeText(value: string): Uint8Array {
  return new TextEncoder().encode(value)
}
