import assert from "node:assert/strict"
import test from "node:test"
import { TextEncoder } from "node:util"

import { parseCam } from "@cam/core"
import type { Abi, Address, Hex } from "viem"

import {
  CamEvmError,
  callCamRoute,
  loadCamFromHost,
  resolveCamContracts,
  verifyCamHash,
  ZERO_HASH,
} from "../src/index.ts"
import type { CamHost, ResourceLoader } from "../src/index.ts"

const host: CamHost = {
  chainId: "eip155:31337",
  address: "0x0000000000000000000000000000000000000001",
}

const userAddress = "0x0000000000000000000000000000000000000002"
const uiAddress = "0x0000000000000000000000000000000000000003"
const managerAddress = "0x0000000000000000000000000000000000000004"

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
] as const satisfies Abi

const managerAbi = [] as const satisfies Abi

test("loadCamFromHost reads root metadata and accepts bytes32(0) as an unsigned CAM", async () => {
  const camBytes = encodeJson(camJson)
  const publicClient = createPublicClient({
    camURI: "ipfs://example/main.json",
    camHash: ZERO_HASH,
  })
  const resources = createResourceLoader({
    "ipfs://example/main.json": camBytes,
  })

  const loaded = await loadCamFromHost({
    publicClient,
    host,
    loadResource: resources,
  })

  assert.equal(loaded.camURI, "ipfs://example/main.json")
  assert.equal(loaded.camHash, ZERO_HASH)
  assert.deepEqual(loaded.cam, parseCam(camJson))
  assert.deepEqual(publicClient.calls.map((call) => call.functionName), ["camURI", "camHash"])
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

test("resolveCamContracts resolves addresses through CamRoot and ABI URIs relative to the CAM", async () => {
  const cam = parseCam(camJson)
  const publicClient = createPublicClient({
    addresses: {
      BicycleComponentManagerUI: uiAddress,
      BicycleComponentManager: managerAddress,
    },
  })
  const resources = createResourceLoader({
    "ipfs://example/abi/BicycleComponentManagerUI.json": encodeJson(uiAbi),
    "ipfs://example/abi/BicycleComponentManager.json": encodeJson(managerAbi),
  })

  const contracts = await resolveCamContracts({
    publicClient,
    host,
    camURI: "ipfs://example/main.json",
    cam,
    loadResource: resources,
  })

  assert.equal(contracts.BicycleComponentManagerUI.address, uiAddress)
  assert.equal(contracts.BicycleComponentManagerUI.abiURI, "ipfs://example/abi/BicycleComponentManagerUI.json")
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
      camURI: "ipfs://example/main.json",
      cam: parseCam(camJson),
      loadResource: createResourceLoader({}),
    }),
    (error) => error instanceof CamEvmError && error.code === "CAM_CONTRACT_UNBOUND",
  )
})

test("callCamRoute resolves CAM args, calls the selected contract, and maps outputs", async () => {
  const cam = parseCam(camJson)
  const publicClient = createPublicClient({
    routeResults: {
      viewEntry: ["./screens/entry.json", BigInt(7)],
    },
  })

  const result = await callCamRoute({
    publicClient,
    cam,
    camURI: "ipfs://example/main.json",
    contracts: {
      BicycleComponentManagerUI: {
        name: "BicycleComponentManagerUI",
        address: uiAddress,
        abiURI: "ipfs://example/abi/BicycleComponentManagerUI.json",
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

  assert.equal(result.route, "entry")
  assert.equal(result.screenURI, "ipfs://example/screens/entry.json")
  assert.deepEqual(result.raw, ["./screens/entry.json", BigInt(7)])
  assert.deepEqual(result.outputs, {
    "0": "./screens/entry.json",
    "1": BigInt(7),
    screenURI: "./screens/entry.json",
    componentCount: BigInt(7),
  })

  assert.deepEqual(publicClient.calls.at(-1), {
    address: uiAddress,
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
      camURI: "ipfs://example/main.json",
      contracts: {
        BicycleComponentManagerUI: {
          name: "BicycleComponentManagerUI",
          address: uiAddress,
          abiURI: "ipfs://example/abi/BicycleComponentManagerUI.json",
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

function createPublicClient({
  camURI = "ipfs://example/main.json",
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

      if (request.functionName === "camURI") {
        return camURI
      }

      if (request.functionName === "camHash") {
        return camHash
      }

      if (request.functionName === "contractAddress") {
        const [name] = request.args ?? []
        return typeof name === "string" && addresses[name] !== undefined
          ? addresses[name]
          : "0x0000000000000000000000000000000000000000"
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

function encodeJson(value: unknown): Uint8Array {
  return encodeText(JSON.stringify(value))
}

function encodeText(value: string): Uint8Array {
  return new TextEncoder().encode(value)
}
