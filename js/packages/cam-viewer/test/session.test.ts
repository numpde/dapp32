import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import test from "node:test"

import { CAM_RESOURCE_MAX_BYTES, CAM_VERSION, toInertValue, UI_VERSION } from "@cam/protocol"

import {
  createCamViewerSession,
} from "../src/index.ts"
import { CamViewerError } from "../src/errors.ts"
import type {
  CamHost,
} from "@cam/evm-viem"
import type { CreateCamViewerSessionOptions } from "../src/index.ts"
import type { Address, Hex } from "viem"
import {
  BIKE_ACCOUNT_ADDRESS as userAddress,
  BIKE_CAM_URI as camURI,
  BIKE_MARK_MISSING,
  BIKE_MANAGER_ADDRESS as managerAddress,
  BIKE_ROUTE_COMPONENT,
  BIKE_ROUTE_ENTRY,
  BIKE_SERIAL_HASH,
  BIKE_SERIAL_NUMBER,
  BIKE_TOKEN_ID,
  BIKE_UNKNOWN_SERIAL_HASH,
  BIKE_UNKNOWN_SERIAL_NUMBER,
  BIKE_UNKNOWN_TOKEN_ID,
  BIKE_UNSIGNED_CAM_HASH,
  BIKE_UI_ABI_URI,
  BIKE_UI_NAMESPACE,
  BIKE_UI_URI,
  BIKE_VIEW_COMPONENT,
  BIKE_VIEW_ENTRY,
  BIKE_ZERO_ADDRESS,
  BIKE_ZERO_BYTES32,
  bikeComponentRouteResult,
  bikeContractAddresses,
  bikeEntryRouteResult,
  bikeHost,
  bikeRegisterRouteResult,
  bikeRouteResults,
} from "../../../../tests/fixtures/cam/bike.mts"
import { bikeManagerAbi } from "../../../../tests/fixtures/cam/bike-resources.mts"
import {
  bikeResourceBytes,
  createMockCamPublicClient,
  createMockResourceLoader as createResourceLoader,
  encodeJson,
} from "../../../../tests/fixtures/cam/mock.mts"

const host: CamHost = bikeHost
const otherUserAddress = "0x0000000000000000000000000000000000000099"
const BIKE_REPORT_URI = "fixture://bike-nft/reports/session-missing.json"
const BIKE_RESOLUTION_URI = "fixture://bike-nft/reports/session-recovered.json"
const BIKE_ACCOUNT_INFO_URI = "fixture://bike-nft/accounts/session-owner.json"
const NO_RESOURCE_OVERRIDES = {}

test("bike fixture models the real UI projection branch states", () => {
  assertBikeProjection(bikeComponentRouteResult("", userAddress, "active"), {
    viewId: "component.empty",
    actions: ["lookupComponent", "openRegister"],
  })
  assertBikeProjection(bikeComponentRouteResult("", BIKE_ZERO_ADDRESS, "active"), {
    viewId: "component.empty",
    actions: ["lookupComponent"],
  })
  assertBikeProjection(bikeComponentRouteResult(BIKE_UNKNOWN_SERIAL_NUMBER, userAddress, "active"), {
    viewId: "component.notFound",
    actions: ["lookupComponent", "openRegister"],
    serialHash: BIKE_UNKNOWN_SERIAL_HASH,
    tokenId: BIKE_UNKNOWN_TOKEN_ID,
  })
  assertBikeProjection(bikeComponentRouteResult(BIKE_UNKNOWN_SERIAL_NUMBER, BIKE_ZERO_ADDRESS, "active"), {
    viewId: "component.notFound",
    actions: ["lookupComponent"],
    serialHash: BIKE_UNKNOWN_SERIAL_HASH,
    tokenId: BIKE_UNKNOWN_TOKEN_ID,
  })
  assertBikeProjection(bikeComponentRouteResult(BIKE_SERIAL_NUMBER, userAddress, "active"), {
    viewId: "component.active",
    actions: ["lookupComponent", "updateComponentMetadata", "markComponentMissing", "retireComponent"],
    serialHash: BIKE_SERIAL_HASH,
    tokenId: BIKE_TOKEN_ID,
  })
  assertBikeProjection(bikeComponentRouteResult(BIKE_SERIAL_NUMBER, userAddress, "missing"), {
    viewId: "component.missing",
    actions: ["lookupComponent", "updateComponentMetadata", "clearComponentMissing"],
    statusId: "missing",
    canMarkMissing: false,
    canClearMissing: true,
    canRetire: false,
  })
  assertBikeProjection(bikeComponentRouteResult(BIKE_SERIAL_NUMBER, userAddress, "retired"), {
    viewId: "component.retired",
    actions: ["lookupComponent"],
    statusId: "retired",
    canUpdateMetadata: false,
    canMarkMissing: false,
    canClearMissing: false,
    canRetire: false,
  })
  assertBikeProjection(bikeComponentRouteResult(BIKE_SERIAL_NUMBER, otherUserAddress, "active"), {
    viewId: "component.active",
    actions: ["lookupComponent"],
    permissions: 0n,
    isOwner: false,
    canUpdateMetadata: false,
    canMarkMissing: false,
    canRetire: false,
  })

  assertBikeProjection(bikeEntryRouteResult(BIKE_ZERO_ADDRESS), {
    viewId: "entry",
    actions: ["lookupComponent"],
    canRegister: false,
  })
  assertBikeProjection(bikeEntryRouteResult(userAddress), {
    viewId: "entry",
    actions: ["lookupComponent", "openRegister", "setAccountInfo"],
    account: userAddress,
    canRegister: true,
  })

  assertBikeProjection(bikeRegisterRouteResult("", userAddress), {
    viewId: "register.empty",
    actions: ["lookupComponent", "openRegister"],
  })
  assertBikeProjection(bikeRegisterRouteResult("", BIKE_ZERO_ADDRESS), {
    viewId: "register.empty",
    actions: ["lookupComponent"],
  })
  assertBikeProjection(bikeRegisterRouteResult(BIKE_UNKNOWN_SERIAL_NUMBER, userAddress), {
    viewId: "register.ready",
    actions: ["registerComponent", "lookupComponent"],
    serialHash: BIKE_UNKNOWN_SERIAL_HASH,
    tokenId: BIKE_UNKNOWN_TOKEN_ID,
  })
  assertBikeProjection(bikeRegisterRouteResult(BIKE_SERIAL_NUMBER, userAddress), {
    viewId: "register.blocked",
    actions: ["lookupComponent"],
    serialHash: BIKE_SERIAL_HASH,
    tokenId: BIKE_TOKEN_ID,
  })
})

test("load resolves host CAM, entry route, UI resource, and entry view", async () => {
  const publicClient = createPublicClient(publicClientFixtureOptions({}))
  const session = createSession(sessionFixtureOptions({ publicClient }))

  const snapshot = await session.load()

  assert.equal(snapshot.route, BIKE_ROUTE_ENTRY)
  assert.equal(snapshot.resolvedUi.element, "Screen")
  assert.equal(snapshot.resolvedUi.children[0]?.element, "Fragment")
  assert.deepEqual(snapshot.values, toInertValue([
    {
      viewId: "entry",
      actions: ["lookupComponent", "openRegister", "setAccountInfo"],
      account: userAddress,
      canRegister: true,
      accountInfo: "Mock registrar account",
      serialNumber: "",
      exists: false,
      serialHash: BIKE_ZERO_BYTES32,
      tokenContract: BIKE_ZERO_ADDRESS,
      tokenId: "0",
      owner: BIKE_ZERO_ADDRESS,
      ownerInfo: "",
      registrar: BIKE_ZERO_ADDRESS,
      statusId: "none",
      tokenURI: "",
      registeredAt: "0",
      updatedAt: "0",
      permissions: "0",
      isOwner: false,
      canUpdateMetadata: false,
      canMarkMissing: false,
      canClearMissing: false,
      canRetire: false,
      componentsAddress: BIKE_ZERO_ADDRESS,
    },
  ]))
  assert.deepEqual(publicClient.calls.map((call) => call.functionName), [
    "supportsInterface",
    "camURI",
    "camHash",
    "contractAddress",
    "contractAddress",
    BIKE_VIEW_ENTRY,
  ])
})

test("session creation validates host and account boundary values", () => {
  const options = sessionFixtureOptions({})

  assert.throws(
    () => createCamViewerSession({
      ...options,
      host: {
        ...host,
        chainId: "31337",
      },
      account: { address: userAddress },
      inputs: {},
      allowUnsignedCamHash: true,
    }),
    /expected CAIP-2 EVM chain id/,
  )

  assert.throws(
    () => createCamViewerSession({
      ...options,
      host: {
        ...host,
        address: "not-an-address" as Address,
      },
      account: { address: userAddress },
      inputs: {},
      allowUnsignedCamHash: true,
    }),
    /host\.address/,
  )

  assert.throws(
    () => createCamViewerSession({
      ...options,
      host,
      account: { address: "not-an-address" as Address },
      inputs: {},
      allowUnsignedCamHash: true,
    }),
    /account\.address/,
  )
})

test("load rejects routes that require an account when none is available", async () => {
  const publicClient = createPublicClient(publicClientFixtureOptions({}))
  const session = createCamViewerSession({
    publicClient,
    host,
    inputs: {},
    allowUnsignedCamHash: true,
    loadResource: createResourceLoader(bikeResourceBytes(NO_RESOURCE_OVERRIDES)),
  })

  await assert.rejects(
    () => session.load(),
    (error) => error instanceof CamViewerError
      && error.code === "CAM_VIEWER_ACTION_UNSUPPORTED"
      && /requires an account/.test(error.message),
  )
  assert.equal(publicClient.calls.some((call) => call.functionName === BIKE_VIEW_ENTRY), false)
})

test("load rejects UI buttons that require an account when none is available", async () => {
  const publicClient = createPublicClient(publicClientFixtureOptions({
    routeResults: {
      viewEntry: {
        title: "Anonymous entry",
      },
    },
  }))
  const abiBytes = encodeJson([
    {
      type: "function",
      name: "viewEntry",
      stateMutability: "view",
      inputs: [],
      outputs: [{
        name: "view",
        type: "tuple",
        components: [{ name: "title", type: "string" }],
      }],
    },
    {
      type: "function",
      name: "save",
      stateMutability: "nonpayable",
      inputs: [{ name: "owner", type: "address" }],
      outputs: [],
    },
  ])
  const uiBytes = encodeJson({
    ui: UI_VERSION,
    nodes: {
      app: {
        element: "Fragment",
        requires: ["view"],
        children: [{
          element: "Button",
          props: {
            label: "Save",
          },
          call: {
            namespace: "routes",
            function: "save",
            args: {
              owner: "$account.address",
            },
          },
        }],
      },
    },
  })
  const camBytes = encodeJson({
    cam: CAM_VERSION,
    entry: "entry",
    namespaces: {
      [BIKE_UI_NAMESPACE]: {
        type: "contract",
        abiURI: "./abi/BicycleComponentManagerUI.json",
        integrity: sha256Integrity(abiBytes),
      },
      ui: {
        type: "ui",
        uri: "./ui.json",
        integrity: sha256Integrity(uiBytes),
      },
      routes: {
        type: "routes",
      },
    },
    routes: {
      entry: {
        kind: "read",
        inputs: [],
        call: {
          namespace: BIKE_UI_NAMESPACE,
          function: "viewEntry",
          args: {},
        },
        then: {
          namespace: "ui",
          function: "app",
          args: {
            view: "$outputs.0",
          },
        },
      },
      save: {
        kind: "write",
        inputs: ["owner"],
        call: {
          namespace: BIKE_UI_NAMESPACE,
          function: "save",
          args: {
            owner: "$inputs.owner",
          },
        },
        then: {
          namespace: "routes",
          function: "entry",
          args: {},
        },
      },
    },
  })
  const session = createCamViewerSession({
    publicClient,
    host,
    inputs: {},
    allowUnsignedCamHash: true,
    loadResource: createResourceLoader({
      [camURI]: camBytes,
      [BIKE_UI_ABI_URI]: abiBytes,
      [BIKE_UI_URI]: uiBytes,
    }),
  })

  await assert.rejects(
    () => session.load(),
    (error) => error instanceof CamViewerError
      && error.code === "CAM_VIEWER_ACTION_UNSUPPORTED"
      && /UI requires an account/.test(error.message),
  )
})

test("snapshot returns isolated copies of nested route and resolved UI data", async () => {
  const session = createSession(sessionFixtureOptions({}))
  const snapshot = await session.load()

  mutableRecord(snapshot.values[0]).accountInfo = "mutated route value"
  mutableRecord(snapshot.resolvedUi.props).title = "mutated title"

  const nextSnapshot = session.snapshot()
  assert.equal(mutableRecord(nextSnapshot.values?.[0]).accountInfo, "Mock registrar account")
  assert.equal(mutableRecord(nextSnapshot.resolvedUi?.props).title, "Bicycle component registry")
})

test("load failures do not expose a partially loaded session", async () => {
  const publicClient = createPublicClient(publicClientFixtureOptions({}))
  const session = createSession(sessionFixtureOptions({
    publicClient: {
      ...publicClient,
      async readContract(request) {
        if (request.functionName === BIKE_VIEW_ENTRY) {
          throw new Error("entry route failed")
        }
        return await publicClient.readContract(request)
      },
    },
  }))

  await assert.rejects(
    () => session.load(),
    (error) => error instanceof Error,
  )
  const failedSnapshot = session.snapshot()
  assert.deepEqual(failedSnapshot.account, { address: userAddress })
  assert.deepEqual(Object.entries(failedSnapshot.inputs), [])
  assert.equal("route" in failedSnapshot, false)
  await assert.rejects(
    () => session.navigate(BIKE_ROUTE_COMPONENT, { serialNumber: BIKE_SERIAL_NUMBER }),
    (error) => error instanceof CamViewerError && error.code === "CAM_VIEWER_NOT_LOADED",
  )
})

test("load rejects oversized UI resources at the loader boundary", async () => {
  const session = createSession(sessionFixtureOptions({
    loadResource: createResourceLoader(bikeResourceBytes({
      [BIKE_UI_URI]: new Uint8Array(CAM_RESOURCE_MAX_BYTES + 1),
    })),
  }))

  await assert.rejects(
    () => session.load(),
    (error) => error instanceof CamViewerError
      && error.code === "CAM_VIEWER_UI_LOAD_FAILED"
      && error.cause instanceof Error
      && /too large/.test(error.cause.message),
  )
})

test("setAccount before load fails without mutating the session", async () => {
  const session = createSession(sessionFixtureOptions({}))

  await assert.rejects(
    () => session.setAccount({ address: otherUserAddress }),
    (error) => error instanceof CamViewerError && error.code === "CAM_VIEWER_NOT_LOADED",
  )

  assert.deepEqual(session.snapshot().account, { address: userAddress })
})

test("setAccount reload failures preserve the previous loaded snapshot", async () => {
  let entryCalls = 0
  const publicClient = createPublicClient(publicClientFixtureOptions({}))
  const session = createSession(sessionFixtureOptions({
    publicClient: {
      ...publicClient,
      async readContract(request) {
        if (request.functionName === BIKE_VIEW_ENTRY) {
          entryCalls += 1
          if (entryCalls > 1) {
            throw new Error("entry reload failed")
          }
        }
        return await publicClient.readContract(request)
      },
    },
  }))

  const before = await session.load()

  await assert.rejects(
    () => session.setAccount({ address: otherUserAddress }),
    (error) => error instanceof Error,
  )

  assert.deepEqual(session.snapshot(), before)
})

test("updateState rejects fields that are not backed by rendered inputs", async () => {
  const session = createSession(sessionFixtureOptions({}))
  const before = await session.load()

  assert.throws(
    () => session.updateState({ typoSerialNumber: BIKE_SERIAL_NUMBER }),
    (error) => error instanceof CamViewerError
      && error.code === "CAM_VIEWER_INVALID_INERT_VALUE",
  )
  assert.deepEqual(session.snapshot(), before)
})

test("updateState resolves route actions, while write routes are surfaced without sending", async () => {
  const routeResults = bikeRouteResults(BIKE_SERIAL_NUMBER, userAddress, "active")
  const publicClient = createPublicClient(publicClientFixtureOptions({ routeResults }))
  const session = createSession(sessionFixtureOptions({ publicClient }))
  await session.load()

  const accountSnapshot = session.updateState({
    accountInfo: BIKE_ACCOUNT_INFO_URI,
  })
  assert.equal("children" in accountSnapshot.resolvedUi, true)
  if (!("children" in accountSnapshot.resolvedUi)) {
    assert.fail("expected entry root children")
  }
  const accountButton = accountSnapshot.resolvedUi.children.find((child) =>
    child.element === "Button" && child.call.function === "setAccountInfo"
  )
  assert.equal(accountButton?.element, "Button")
  if (accountButton?.element !== "Button") {
    assert.fail("expected account-info write button")
  }

  const accountResult = await session.dispatchAction(accountButton)
  assert.equal(accountResult.type, "contractCall")
  if (accountResult.type !== "contractCall") {
    assert.fail("expected account-info contract call action result")
  }
  assert.equal(accountResult.call.route, "setAccountInfo")
  assert.equal(accountResult.call.address, managerAddress)
  assert.equal(accountResult.call.function, "setAccountInfo")
  assert.deepEqual(accountResult.call.args, toInertValue({ infoURI: BIKE_ACCOUNT_INFO_URI }))
  assert.equal(accountResult.call.then.namespace, "routes")
  assert.equal(accountResult.call.then.function, BIKE_ROUTE_ENTRY)

  const snapshot = session.updateState({
    serialNumber: BIKE_SERIAL_NUMBER,
  })

  assert.equal("children" in snapshot.resolvedUi, true)
  if (!("children" in snapshot.resolvedUi)) {
    assert.fail("expected resolved root children")
  }
  const action = snapshot.resolvedUi.children.find((child) => child.element === "Button")
  assert.equal(action?.element, "Button")
  if (action?.element !== "Button") {
    assert.fail("expected resolved action")
  }
  assert.equal(action.call.function, BIKE_ROUTE_COMPONENT)
  assert.equal(action.call.args.serialNumber, BIKE_SERIAL_NUMBER)

  const result = await session.dispatchAction(action)

  assert.equal(result.type, "navigated")
  if (result.type !== "navigated") {
    assert.fail("expected navigation action result")
  }
  assert.equal(result.snapshot.route, BIKE_ROUTE_COMPONENT)
  assert.equal(result.snapshot.inputs.serialNumber, BIKE_SERIAL_NUMBER)
  assert.equal(publicClient.calls.at(-1)?.functionName, BIKE_VIEW_COMPONENT)
  assert.deepEqual(publicClient.calls.at(-1)?.args, [BIKE_SERIAL_NUMBER, userAddress])

  const reportSnapshot = session.updateState({
    reportURI: BIKE_REPORT_URI,
  })

  assert.equal("children" in reportSnapshot.resolvedUi, true)
  if (!("children" in reportSnapshot.resolvedUi)) {
    assert.fail("expected resolved root children")
  }
  const writeButton = reportSnapshot.resolvedUi.children.find((child) =>
    child.element === "Button" && child.call.function === "markComponentMissing"
  )
  assert.equal(writeButton?.element, "Button")
  if (writeButton?.element !== "Button") {
    assert.fail("expected resolved write button")
  }

  const callsBefore = publicClient.calls.length
  const contractResult = await session.dispatchAction(writeButton)

  assert.equal(contractResult.type, "contractCall")
  if (contractResult.type !== "contractCall") {
    assert.fail("expected contract call action result")
  }
  assert.equal(contractResult.call.route, "markComponentMissing")
  assert.equal(contractResult.call.address, managerAddress)
  assert.equal(contractResult.call.function, BIKE_MARK_MISSING)
  assert.deepEqual(contractResult.call.abi, toInertValue(bikeManagerAbi))
  assert.deepEqual(
    contractResult.call.args,
    toInertValue({ serialNumber: BIKE_SERIAL_NUMBER, reportURI: BIKE_REPORT_URI }),
  )
  assert.equal(contractResult.call.then.namespace, "routes")
  assert.equal(contractResult.call.then.function, BIKE_ROUTE_COMPONENT)
  assert.equal(publicClient.calls.length, callsBefore)

  const missingResult = bikeComponentRouteResult(BIKE_SERIAL_NUMBER, userAddress, "missing")
  routeResults[BIKE_VIEW_COMPONENT] = missingResult
  const missingSnapshot = await session.navigate(BIKE_ROUTE_COMPONENT, { serialNumber: BIKE_SERIAL_NUMBER })
  const resolutionSnapshot = session.updateState({
    resolutionURI: BIKE_RESOLUTION_URI,
  })

  assert.deepEqual(resolutionSnapshot.values, missingSnapshot.values)
  assert.equal("children" in resolutionSnapshot.resolvedUi, true)
  if (!("children" in resolutionSnapshot.resolvedUi)) {
    assert.fail("expected missing resolved root children")
  }
  const clearButton = resolutionSnapshot.resolvedUi.children.find((child) =>
    child.element === "Button" && child.call.function === "clearComponentMissing"
  )
  assert.equal(clearButton?.element, "Button")
  if (clearButton?.element !== "Button") {
    assert.fail("expected resolved clear button")
  }

  const clearResult = await session.dispatchAction(clearButton)
  assert.equal(clearResult.type, "contractCall")
  if (clearResult.type !== "contractCall") {
    assert.fail("expected clear contract call action result")
  }
  assert.equal(clearResult.call.route, "clearComponentMissing")
  assert.equal(clearResult.call.address, managerAddress)
  assert.equal(clearResult.call.function, "clearComponentMissing")
  assert.deepEqual(clearResult.call.args, toInertValue({
    serialNumber: BIKE_SERIAL_NUMBER,
    resolutionURI: BIKE_RESOLUTION_URI,
  }))
})

test("dispatchAction rejects actions that are not rendered in the current view", async () => {
  const publicClient = createPublicClient(publicClientFixtureOptions({}))
  const session = createSession(sessionFixtureOptions({ publicClient }))
  await session.load()
  const callsBefore = publicClient.calls.length

  await assert.rejects(
    () => session.dispatchAction({
      element: "Button",
      props: {
        label: "Hidden write",
      },
      call: {
        namespace: "routes",
        function: BIKE_MARK_MISSING,
        args: {
          serialNumber: BIKE_SERIAL_NUMBER,
          reportURI: BIKE_REPORT_URI,
        },
      },
    }),
    (error) => error instanceof CamViewerError
      && error.code === "CAM_VIEWER_ACTION_UNSUPPORTED"
      && /not rendered/.test(error.message),
  )
  assert.equal(publicClient.calls.length, callsBefore)
})

function createSession({
  publicClient,
  loadResource,
}: SessionFixtureOptions) {
  return createCamViewerSession({
    publicClient,
    host,
    account: { address: userAddress },
    inputs: {},
    allowUnsignedCamHash: true,
    loadResource,
  })
}

function createPublicClient({
  chainId,
  camHash,
  supportsCamInterface,
  addresses,
  routeResults,
}: PublicClientFixtureOptions) {
  // This fake models raw viem return values before @cam/evm-viem normalizes
  // them to RouteResult.values.
  return createMockCamPublicClient({
    chainId,
    camURI,
    camHash,
    supportsCamInterface,
    addresses,
    routeResults,
  })
}

type SessionFixtureOptions = {
  readonly publicClient: ReturnType<typeof createPublicClient>
  readonly loadResource: CreateCamViewerSessionOptions["loadResource"]
}

type PublicClientFixtureOptions = {
  readonly chainId: number
  readonly camHash: Hex
  readonly supportsCamInterface: boolean
  readonly addresses: Readonly<Record<string, Address>>
  readonly routeResults: Record<string, unknown>
}

function sessionFixtureOptions(overrides: Partial<SessionFixtureOptions>): SessionFixtureOptions {
  return {
    publicClient: createPublicClient(publicClientFixtureOptions({})),
    loadResource: createResourceLoader(bikeResourceBytes(NO_RESOURCE_OVERRIDES)),
    ...overrides,
  }
}

function publicClientFixtureOptions(overrides: Partial<PublicClientFixtureOptions>): PublicClientFixtureOptions {
  return {
    chainId: 31337,
    camHash: BIKE_UNSIGNED_CAM_HASH,
    supportsCamInterface: true,
    addresses: bikeContractAddresses,
    routeResults: bikeRouteResults(BIKE_SERIAL_NUMBER, userAddress, "active"),
    ...overrides,
  }
}

function assertBikeProjection(
  actual: Record<string, unknown>,
  expected: Readonly<Record<string, unknown>>,
): void {
  for (const [key, value] of Object.entries(expected)) {
    assert.deepEqual(actual[key], value)
  }
}

function mutableRecord(value: unknown): Record<string, unknown> {
  assert.equal(typeof value, "object")
  assert.notEqual(value, null)
  assert.equal(Array.isArray(value), false)
  return value as Record<string, unknown>
}

function sha256Integrity(bytes: Uint8Array): string {
  return `sha256:0x${createHash("sha256").update(bytes).digest("hex")}`
}
