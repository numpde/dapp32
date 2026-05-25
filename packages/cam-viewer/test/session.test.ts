import assert from "node:assert/strict"
import test from "node:test"
import { TextEncoder } from "node:util"

import { CamEvmError, ZERO_HASH } from "@cam/evm-viem"
import type { Abi, Address, Hex } from "viem"

import {
  CamViewerError,
  createCamViewerSession,
} from "../src/index.ts"
import type { CamHost } from "@cam/evm-viem"

const host: CamHost = {
  chainId: "eip155:31337",
  address: "0x0000000000000000000000000000000000000001",
}

const userAddress = "0x0000000000000000000000000000000000000002"
const uiAddress = "0x0000000000000000000000000000000000000003"
const managerAddress = "0x0000000000000000000000000000000000000004"
const camURI = "ipfs://example/main.json"
const uiAbiURI = "ipfs://example/abi/BicycleComponentManagerUI.json"
const managerAbiURI = "ipfs://example/abi/BicycleComponentManager.json"
const entryScreenURI = "ipfs://example/screens/entry.json"
const componentScreenURI = "ipfs://example/screens/component.json"
const registerScreenURI = "ipfs://example/screens/register.json"

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
    outputs: [{ name: "screenURI", type: "string" }],
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

test("load resolves host CAM, entry route, and entry screen", async () => {
  const publicClient = createPublicClient()
  const session = createSession({ publicClient })

  const snapshot = await session.load()

  assert.equal(snapshot.loaded, true)
  assert.equal(snapshot.route, "entry")
  assert.equal(snapshot.screenURI, entryScreenURI)
  assert.equal(snapshot.screen?.title, "Entry")
  assert.equal(snapshot.resolvedScreen?.title, "Entry")
  assert.deepEqual(snapshot.values, [
    "./screens/entry.json",
    {
      account: userAddress,
      canRegister: true,
    },
  ])
  assert.deepEqual(publicClient.calls.map((call) => call.functionName), [
    "camURI",
    "camHash",
    "contractAddress",
    "contractAddress",
    "viewEntry",
  ])
})

test("dispatchAction executes navigation actions", async () => {
  const publicClient = createPublicClient()
  const session = createSession({ publicClient })
  await session.load()

  const result = await session.dispatchAction({
    route: "component",
    params: {
      serialNumber: "ABC123",
    },
  })

  assert.equal(result.type, "navigated")
  assert.equal(result.snapshot.route, "component")
  assert.equal(result.snapshot.params.serialNumber, "ABC123")
  assert.equal(result.snapshot.screenURI, componentScreenURI)
  assert.equal(publicClient.calls.at(-1)?.functionName, "viewComponent")
  assert.deepEqual(publicClient.calls.at(-1)?.args, ["ABC123", userAddress])
})

test("navigate works for the register route", async () => {
  const session = createSession()
  await session.load()

  const snapshot = await session.navigate("register", {
    serialNumber: "ABC123",
  })

  assert.equal(snapshot.route, "register")
  assert.equal(snapshot.screenURI, registerScreenURI)
  assert.equal(snapshot.resolvedScreen?.title, "Register")
})

test("setState updates local state without calling a route", async () => {
  const publicClient = createPublicClient()
  const session = createSession({ publicClient })
  await session.load()
  const callsBefore = publicClient.calls.length

  const snapshot = session.setState({
    serialNumber: "ABC123",
  })

  assert.equal(snapshot.state.serialNumber, "ABC123")
  assert.equal(publicClient.calls.length, callsBefore)
})

test("setState re-resolves current screen actions with updated state", async () => {
  const session = createSession({
    resources: {
      [entryScreenURI]: encodeJson({
        screen: "1.0.0",
        title: "Entry",
        elements: [
          {
            type: "input",
            name: "serialNumber",
            label: "Serial number",
          },
          {
            type: "button",
            label: "Look up",
            action: {
              route: "component",
              params: {
                serialNumber: "$state.serialNumber",
              },
            },
          },
        ],
      }),
    },
  })
  await session.load()

  const snapshot = session.setState({
    serialNumber: "ABC123",
  })

  assert.deepEqual(snapshot.resolvedScreen?.elements[0], {
    type: "input",
    name: "serialNumber",
    label: "Serial number",
  })
  assert.deepEqual(snapshot.resolvedScreen?.elements[1], {
    type: "button",
    label: "Look up",
    action: {
      route: "component",
      params: {
        serialNumber: "ABC123",
      },
    },
  })
})

test("dispatchAction surfaces contract calls without sending transactions", async () => {
  const publicClient = createPublicClient()
  const session = createSession({ publicClient })
  await session.load()
  const callsBefore = publicClient.calls.length

  const action = {
    contract: "BicycleComponentManager",
    function: "markMissing",
    args: ["ABC123"],
  }
  const result = await session.dispatchAction(action)

  assert.deepEqual(result, {
    type: "contractCall",
    action,
  })
  assert.equal(publicClient.calls.length, callsBefore)
})

test("navigate rejects before load", async () => {
  const session = createSession()

  await assert.rejects(
    () => session.navigate("entry"),
    (error) => error instanceof CamViewerError && error.code === "CAM_VIEWER_NOT_LOADED",
  )
})

test("dispatchAction rejects unsupported runtime action shapes", async () => {
  const session = createSession()
  await session.load()

  await assert.rejects(
    () => session.dispatchAction({ route: "component" } as never),
    (error) => error instanceof CamViewerError && error.code === "CAM_VIEWER_ACTION_UNSUPPORTED",
  )
})

test("load wraps missing screen resources", async () => {
  const session = createSession({
    publicClient: createPublicClient({
      routeResults: {
        viewEntry: ["./screens/missing.json"],
      },
    }),
  })

  await assert.rejects(
    () => session.load(),
    (error) => error instanceof CamViewerError && error.code === "CAM_VIEWER_SCREEN_LOAD_FAILED",
  )
})

test("load wraps invalid screen JSON and schema errors", async () => {
  const session = createSession({
    resources: {
      [entryScreenURI]: encodeJson({
        screen: "1.0.0",
        elements: [
          {
            type: "html",
          },
        ],
      }),
    },
  })

  await assert.rejects(
    () => session.load(),
    (error) => error instanceof CamViewerError && error.code === "CAM_VIEWER_SCREEN_PARSE_FAILED",
  )
})

test("load leaves route call failures as EVM adapter errors", async () => {
  const session = createSession({
    publicClient: createPublicClient({
      routeResults: {},
    }),
  })

  await assert.rejects(
    () => session.load(),
    (error) => error instanceof CamEvmError && error.code === "CAM_ROUTE_CALL_FAILED",
  )
})

function createSession({
  publicClient = createPublicClient(),
  resources = {},
}: {
  readonly publicClient?: ReturnType<typeof createPublicClient>
  readonly resources?: Record<string, Uint8Array>
} = {}) {
  return createCamViewerSession({
    publicClient,
    host,
    account: { address: userAddress },
    loadResource: createResourceLoader({
      [camURI]: encodeJson(camJson),
      [uiAbiURI]: encodeJson(uiAbi),
      [managerAbiURI]: encodeJson(managerAbi),
      [entryScreenURI]: encodeJson(entryScreen),
      [componentScreenURI]: encodeJson(componentScreen),
      [registerScreenURI]: encodeJson(registerScreen),
      ...resources,
    }),
  })
}

function createPublicClient({
  camHash = ZERO_HASH,
  addresses = {
    BicycleComponentManagerUI: uiAddress,
    BicycleComponentManager: managerAddress,
  },
  routeResults = {
    viewEntry: [
      "./screens/entry.json",
      {
        account: userAddress,
        canRegister: true,
      },
    ],
    viewComponent: [
      "./screens/component.json",
      {
        serialNumber: "ABC123",
        exists: true,
      },
    ],
    viewRegister: [
      "./screens/register.json",
      {
        serialNumber: "ABC123",
        canRegister: true,
      },
    ],
  },
}: {
  readonly camHash?: Hex
  readonly addresses?: Record<string, Address>
  readonly routeResults?: Record<string, unknown>
} = {}) {
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
      readonly abi?: Abi
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

function createResourceLoader(resources: Record<string, Uint8Array>) {
  return async (uri: string): Promise<Uint8Array> => {
    const bytes = resources[uri]
    if (bytes === undefined) {
      throw new Error(`unexpected resource URI: ${uri}`)
    }

    return bytes
  }
}

const entryScreen = {
  screen: "1.0.0",
  title: "Entry",
  elements: [
    {
      type: "status",
      label: "Can register",
      value: "$values.1.canRegister",
    },
  ],
}

const componentScreen = {
  screen: "1.0.0",
  title: "Component",
  elements: [
    {
      type: "status",
      label: "Serial number",
      value: "$values.1.serialNumber",
    },
  ],
}

const registerScreen = {
  screen: "1.0.0",
  title: "Register",
  elements: [
    {
      type: "status",
      label: "Can register",
      value: "$values.1.canRegister",
    },
  ],
}

function encodeJson(value: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(value))
}
