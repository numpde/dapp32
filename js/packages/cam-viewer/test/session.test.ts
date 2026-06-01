import assert from "node:assert/strict"
import test from "node:test"

import { toInertValue } from "@cam/protocol"
import type { InertValue } from "@cam/protocol"

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
  BIKE_SERIAL_NUMBER,
  BIKE_UNSIGNED_CAM_HASH,
  BIKE_UI_NAMESPACE,
  BIKE_VIEW_COMPONENT,
  BIKE_VIEW_ENTRY,
  bikeContractAddresses,
  bikeHost,
  bikeManagerAbi,
  bikeRouteResults,
} from "../../../../tests/fixtures/cam/bike.mts"
import {
  bikeResourceBytes,
  createMockCamPublicClient,
  createMockResourceLoader as createResourceLoader,
} from "../../../../tests/fixtures/cam/mock.mts"

const host: CamHost = bikeHost
const otherUserAddress = "0x0000000000000000000000000000000000000099"
const NO_RESOURCE_OVERRIDES = {}

test("load resolves host CAM, entry route, UI resource, and entry view", async () => {
  const publicClient = createPublicClient(publicClientFixtureOptions({}))
  const session = createSession(sessionFixtureOptions({ publicClient }))

  const snapshot = await session.load()

  assert.equal(snapshot.route, BIKE_ROUTE_ENTRY)
  assert.equal(snapshot.resolvedUi.tag, "Screen")
  assert.equal(snapshot.resolvedUi.children[0]?.tag, "Fragment")
  assert.deepEqual(snapshot.values, inert([
    {
      viewId: "entry",
      actions: ["lookupComponent", "openRegister"],
      account: userAddress,
      canRegister: true,
      accountInfo: "Mock registrar account",
      serialNumber: "",
      exists: false,
      serialHash: "0x0000000000000000000000000000000000000000000000000000000000000000",
      tokenContract: "0x0000000000000000000000000000000000000010",
      tokenId: "0",
      owner: userAddress,
      ownerInfo: "",
      registrar: userAddress,
      status: "0",
      tokenURI: "",
      registeredAt: "0",
      updatedAt: "0",
      permissions: "0",
      isOwner: false,
      canUpdateMetadata: false,
      canMarkMissing: false,
      canClearMissing: false,
      canRetire: false,
      componentsAddress: "0x0000000000000000000000000000000000000010",
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

test("snapshot returns isolated copies of nested route and resolved UI data", async () => {
  const session = createSession(sessionFixtureOptions({}))
  const snapshot = await session.load()

  mutableRecord(snapshot.values[0]).accountInfo = "mutated route value"
  mutableRecord(snapshot.resolvedUi.props).title = "mutated title"

  const nextSnapshot = session.snapshot()
  assert.equal(mutableRecord(nextSnapshot.values?.[0]).accountInfo, "Mock registrar account")
  assert.equal(mutableRecord(nextSnapshot.resolvedUi?.props).title, "Bicycle component registry")
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
      readContract: (async (request) => {
        if (request.functionName === BIKE_VIEW_ENTRY) {
          entryCalls += 1
          if (entryCalls > 1) {
            throw new Error("entry reload failed")
          }
        }
        return await publicClient.readContract(request)
      }) as typeof publicClient.readContract,
    },
  }))

  const before = await session.load()

  await assert.rejects(
    () => session.setAccount({ address: otherUserAddress }),
    (error) => error instanceof Error,
  )

  assert.deepEqual(session.snapshot(), before)
})

test("updateForm resolves route actions, while write routes are surfaced without sending", async () => {
  const publicClient = createPublicClient(publicClientFixtureOptions({}))
  const session = createSession(sessionFixtureOptions({ publicClient }))
  await session.load()

  const snapshot = session.updateForm({
    serialNumber: BIKE_SERIAL_NUMBER,
  })

  assert.equal("children" in snapshot.resolvedUi, true)
  if (!("children" in snapshot.resolvedUi)) {
    assert.fail("expected resolved root children")
  }
  const action = snapshot.resolvedUi.children.find((child) => child.tag === "Action")
  assert.equal(action?.tag, "Action")
  if (action?.tag !== "Action") {
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

  assert.equal("children" in result.snapshot.resolvedUi, true)
  if (!("children" in result.snapshot.resolvedUi)) {
    assert.fail("expected resolved root children")
  }
  const writeAction = result.snapshot.resolvedUi.children.find((child) => child.tag === "Action")
  assert.equal(writeAction?.tag, "Action")
  if (writeAction?.tag !== "Action") {
    assert.fail("expected resolved write action")
  }

  const callsBefore = publicClient.calls.length
  const contractResult = await session.dispatchAction(writeAction)

  assert.equal(contractResult.type, "contractCall")
  if (contractResult.type !== "contractCall") {
    assert.fail("expected contract call action result")
  }
  assert.equal(contractResult.call.route, "markComponentMissing")
  assert.equal(contractResult.call.address, managerAddress)
  assert.equal(contractResult.call.function, BIKE_MARK_MISSING)
  assert.deepEqual(contractResult.call.abi, toInertValue(bikeManagerAbi))
  assert.deepEqual(contractResult.call.args, toInertValue({ serialNumber: BIKE_SERIAL_NUMBER }))
  assert.equal(contractResult.call.then.namespace, "routes")
  assert.equal(contractResult.call.then.function, BIKE_ROUTE_COMPONENT)
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
  camHash,
  addresses,
  routeResults,
}: PublicClientFixtureOptions) {
  // This fake models raw viem return values before @cam/evm-viem normalizes
  // them to RouteResult.values.
  return createMockCamPublicClient<CreateCamViewerSessionOptions["publicClient"]["readContract"]>({
    camURI,
    camHash,
    addresses,
    routeResults,
  })
}

type SessionFixtureOptions = {
  readonly publicClient: ReturnType<typeof createPublicClient>
  readonly loadResource: CreateCamViewerSessionOptions["loadResource"]
}

type PublicClientFixtureOptions = {
  readonly camHash: Hex
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
    camHash: BIKE_UNSIGNED_CAM_HASH,
    addresses: bikeContractAddresses,
    routeResults: bikeRouteResults(BIKE_SERIAL_NUMBER, userAddress),
    ...overrides,
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
