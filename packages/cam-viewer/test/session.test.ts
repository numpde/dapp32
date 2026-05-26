import assert from "node:assert/strict"
import test from "node:test"
import { TextEncoder } from "node:util"

import { CamEvmError } from "@cam/evm-viem"
import { toInertValue } from "@cam/core"
import type { InertValue } from "@cam/core"

import * as camViewer from "../src/index.ts"
import {
  CamViewerError,
  createCamViewerSession,
} from "../src/index.ts"
import type {
  CamHost,
  ResolvedCamContract,
} from "@cam/evm-viem"
import type { CreateCamViewerSessionOptions } from "../src/index.ts"
import type { Hex } from "viem"
import {
  BIKE_ACCOUNT_ADDRESS as userAddress,
  BIKE_CAM_URI as camURI,
  BIKE_COMPONENT_SCREEN_URI as componentScreenURI,
  BIKE_ENTRY_SCREEN_URI as entryScreenURI,
  BIKE_MARK_MISSING,
  BIKE_MANAGER_ABI_URI as managerAbiURI,
  BIKE_MANAGER_CONTRACT,
  BIKE_REGISTER_SCREEN_URI as registerScreenURI,
  BIKE_RELATIVE_ENTRY_SCREEN_URI,
  BIKE_ROUTE_COMPONENT,
  BIKE_ROUTE_ENTRY,
  BIKE_ROUTE_REGISTER,
  BIKE_SERIAL_NUMBER,
  BIKE_UNSIGNED_CAM_HASH,
  BIKE_UI_ABI_URI as uiAbiURI,
  BIKE_VIEW_COMPONENT,
  BIKE_VIEW_ENTRY,
  bikeCamJson as camJson,
  bikeContractAddresses,
  bikeHost,
  bikeManagerAbi as managerAbi,
  bikeRouteResults,
  bikeUiAbi as uiAbi,
} from "../../../tests/fixtures/cam/bike.mts"

const host: CamHost = bikeHost
type MockAddress = CamHost["address"]
type MockAbi = ResolvedCamContract["abi"]
type MockHash = Hex

test("keeps the public API to the CAM viewer boundary", () => {
  assert.deepEqual(Object.keys(camViewer).sort(), [
    "CamViewerError",
    "createCamViewerSession",
  ])
})

test("load resolves host CAM, entry route, and entry screen", async () => {
  const publicClient = createPublicClient()
  const session = createSession({ publicClient })

  const snapshot = await session.load()

  assert.equal(snapshot.route, BIKE_ROUTE_ENTRY)
  assert.equal(snapshot.screenURI, entryScreenURI)
  assert.equal(snapshot.resolvedScreen?.title, "Entry")
  assert.deepEqual(snapshot.values, inert([
    {
      account: userAddress,
      canRegister: true,
      accountInfo: "Mock registrar account",
    },
  ]))
  assert.deepEqual(publicClient.calls.map((call) => call.functionName), [
    "camURI",
    "camHash",
    "contractAddress",
    "contractAddress",
    BIKE_VIEW_ENTRY,
  ])
})

test("dispatchAction executes navigation actions", async () => {
  const publicClient = createPublicClient()
  const session = createSession({ publicClient })
  await session.load()

  const result = await session.dispatchAction({
    route: BIKE_ROUTE_COMPONENT,
    params: {
      serialNumber: BIKE_SERIAL_NUMBER,
    },
  })

  assert.equal(result.type, "navigated")
  if (result.type !== "navigated") {
    assert.fail("expected navigation action result")
  }
  assert.equal(result.snapshot.route, BIKE_ROUTE_COMPONENT)
  assert.equal(result.snapshot.params.serialNumber, BIKE_SERIAL_NUMBER)
  assert.equal(result.snapshot.screenURI, componentScreenURI)
  assert.equal(publicClient.calls.at(-1)?.functionName, BIKE_VIEW_COMPONENT)
  assert.deepEqual(publicClient.calls.at(-1)?.args, [BIKE_SERIAL_NUMBER, userAddress])
})

test("navigate works for the register route", async () => {
  const session = createSession()
  await session.load()

  const snapshot = await session.navigate(BIKE_ROUTE_REGISTER, {
    serialNumber: BIKE_SERIAL_NUMBER,
  })

  assert.equal(snapshot.route, BIKE_ROUTE_REGISTER)
  assert.equal(snapshot.screenURI, registerScreenURI)
  assert.equal(snapshot.resolvedScreen?.title, "Register")
})

test("navigate accepts explicit empty route params", async () => {
  const publicClient = createPublicClient()
  const session = createSession({ publicClient })
  await session.load()
  await session.navigate(BIKE_ROUTE_COMPONENT, {
    serialNumber: BIKE_SERIAL_NUMBER,
  })

  const snapshot = await session.navigate(BIKE_ROUTE_ENTRY, {})

  assert.deepEqual(snapshot.params, inert({}))
  assert.deepEqual(publicClient.calls.at(-1)?.args, [userAddress])
})

test("setState updates local state without calling a route", async () => {
  const publicClient = createPublicClient()
  const session = createSession({ publicClient })
  await session.load()
  const callsBefore = publicClient.calls.length

  const snapshot = session.setState({
    serialNumber: BIKE_SERIAL_NUMBER,
  })

  assert.equal(snapshot.state.serialNumber, BIKE_SERIAL_NUMBER)
  assert.equal(publicClient.calls.length, callsBefore)
})

test("setState re-resolves current screen actions with updated state", async () => {
  const session = createSession({
    state: {
      serialNumber: "",
    },
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
              route: BIKE_ROUTE_COMPONENT,
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
    serialNumber: BIKE_SERIAL_NUMBER,
  })

  assert.deepEqual(snapshot.resolvedScreen?.elements[0], inert({
    type: "input",
    name: "serialNumber",
    label: "Serial number",
  }))
  assert.deepEqual(snapshot.resolvedScreen?.elements[1], inert({
    type: "button",
    label: "Look up",
    action: {
      route: BIKE_ROUTE_COMPONENT,
      params: {
        serialNumber: BIKE_SERIAL_NUMBER,
      },
    },
  }))
})

test("snapshot returns isolated copies of nested route and resolved screen data", async () => {
  const session = createSession({
    resources: {
      [entryScreenURI]: encodeJson({
        screen: "1.0.0",
        title: "Entry",
        elements: [
          {
            type: "status",
            label: "Account",
            value: "$values.0",
          },
        ],
      }),
    },
  })

  const snapshot = await session.load()

  mutableRecord(snapshot.values?.[0]).accountInfo = "mutated route value"
  mutableRecord(mutableRecord(snapshot.resolvedScreen?.elements[0]).value).accountInfo = "mutated resolved value"

  const nextSnapshot = session.snapshot()
  assert.equal(mutableRecord(nextSnapshot.values?.[0]).accountInfo, "Mock registrar account")
  assert.equal(
    mutableRecord(mutableRecord(nextSnapshot.resolvedScreen?.elements[0]).value).accountInfo,
    "Mock registrar account",
  )
})

test("setState and navigate copy caller-owned nested input records", async () => {
  const session = createSession()
  await session.load()

  const patch = {
    nested: {
      value: "before",
    },
  }
  const stateSnapshot = session.setState(patch)
  patch.nested.value = "after"
  mutableRecord(stateSnapshot.state.nested).value = "snapshot mutation"

  assert.equal(mutableRecord(session.snapshot().state.nested).value, "before")

  const routeParams = {
    serialNumber: BIKE_SERIAL_NUMBER,
    nested: {
      value: "before",
    },
  }
  const routeSnapshot = await session.navigate(BIKE_ROUTE_COMPONENT, routeParams)
  routeParams.nested.value = "after"
  mutableRecord(routeSnapshot.params.nested).value = "snapshot mutation"

  assert.equal(mutableRecord(session.snapshot().params.nested).value, "before")
})

test("setState rejects unsupported mutable object values instead of storing live references", async () => {
  const session = createSession()
  await session.load()

  assert.throws(
    () => session.setState({ date: new Date(0) as unknown as InertValue }),
    (error) => error instanceof CamViewerError && error.code === "CAM_VIEWER_INVALID_INERT_VALUE",
  )
})

test("dispatchAction surfaces contract calls without sending transactions", async () => {
  const publicClient = createPublicClient()
  const session = createSession({ publicClient })
  await session.load()
  const callsBefore = publicClient.calls.length

  const action = {
    contract: BIKE_MANAGER_CONTRACT,
    function: BIKE_MARK_MISSING,
    args: [BIKE_SERIAL_NUMBER],
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
    () => session.navigate(BIKE_ROUTE_ENTRY, {}),
    (error) => error instanceof CamViewerError && error.code === "CAM_VIEWER_NOT_LOADED",
  )
})

test("dispatchAction rejects unsupported runtime action shapes", async () => {
  const session = createSession()
  await session.load()

  await assert.rejects(
    () => session.dispatchAction({ route: BIKE_ROUTE_COMPONENT } as never),
    (error) => error instanceof CamViewerError && error.code === "CAM_VIEWER_ACTION_UNSUPPORTED",
  )
})

test("load wraps missing screen resources", async () => {
  const session = createSession({
    publicClient: createPublicClient({
      routeResults: {
        [BIKE_VIEW_ENTRY]: ["./screens/missing.json"],
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
  // This helper builds a complete happy-path session by default. Tests for
  // missing resources or client behavior pass the dependency explicitly.
  publicClient = createPublicClient(),
  resources = {},
  state = {},
}: {
  readonly publicClient?: ReturnType<typeof createPublicClient>
  readonly resources?: Record<string, Uint8Array>
  readonly state?: Record<string, InertValue>
} = {}) {
  return createCamViewerSession({
    publicClient,
    host,
    account: { address: userAddress },
    params: {},
    state,
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
  // These are viewer test defaults, not protocol defaults. Tests override them
  // when hash, binding, or route output behavior is under scrutiny.
  camHash = BIKE_UNSIGNED_CAM_HASH,
  addresses = bikeContractAddresses,
  routeResults = bikeRouteResults(BIKE_SERIAL_NUMBER, userAddress),
}: {
  readonly camHash?: MockHash
  readonly addresses?: Record<string, MockAddress>
  // This fake models raw viem return values before @cam/evm-viem normalizes
  // them to RouteResult.values.
  readonly routeResults?: Record<string, unknown>
} = {}) {
  const calls: Array<{
    readonly address: MockAddress
    readonly abi?: MockAbi
    readonly functionName: string
    readonly args?: readonly unknown[]
    readonly account?: MockAddress
  }> = []

  type MockReadContractRequest = {
    readonly address?: MockAddress
    readonly abi?: MockAbi
    readonly functionName: string
    readonly args?: readonly unknown[]
    readonly account?: MockAddress
  }

  async function readContract(request: MockReadContractRequest): Promise<unknown> {
    const call: {
      address: MockAddress
      abi?: MockAbi
      functionName: string
      args?: readonly unknown[]
      account?: MockAddress
    } = {
      address: request.address ?? host.address,
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
        : "0x0000000000000000000000000000000000000000"
    }

    if (Object.hasOwn(routeResults, request.functionName)) {
      return routeResults[request.functionName]
    }

    throw new Error(`unexpected readContract call: ${request.functionName}`)
  }

  return {
    calls,
    readContract: readContract as CreateCamViewerSessionOptions["publicClient"]["readContract"],
  }
}

function requireContractName(args: readonly unknown[] | undefined): string {
  if (args?.length !== 1 || typeof args[0] !== "string") {
    throw new Error("contractAddress expected one string argument")
  }

  return args[0]
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

function mutableRecord(value: unknown): Record<string, unknown> {
  assert.equal(typeof value, "object")
  assert.notEqual(value, null)
  assert.equal(Array.isArray(value), false)
  return value as Record<string, unknown>
}

function inert(value: unknown): InertValue {
  return toInertValue(value)
}

const entryScreen = {
  screen: "1.0.0",
  title: "Entry",
  elements: [
    {
      type: "status",
      label: "Can register",
      value: "$values.0.canRegister",
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
      value: "$values.0.serialNumber",
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
      value: "$values.0.canRegister",
    },
  ],
}

function encodeJson(value: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(value))
}
