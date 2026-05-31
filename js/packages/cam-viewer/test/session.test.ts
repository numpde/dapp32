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
  BIKE_COMPONENT_FOUND_SCREEN_URI as componentScreenURI,
  BIKE_ENTRY_SCREEN_URI as entryScreenURI,
  BIKE_MARK_MISSING,
  BIKE_MANAGER_ADDRESS as managerAddress,
  BIKE_MANAGER_CONTRACT,
  BIKE_ROUTE_COMPONENT,
  BIKE_ROUTE_ENTRY,
  BIKE_SERIAL_NUMBER,
  BIKE_UNSIGNED_CAM_HASH,
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
  encodeJson,
} from "../../../../tests/fixtures/cam/mock.mts"

const host: CamHost = bikeHost
const otherUserAddress = "0x0000000000000000000000000000000000000099"
const NO_RESOURCE_OVERRIDES = {}

test("load resolves host CAM, entry route, and entry screen", async () => {
  const publicClient = createPublicClient(publicClientFixtureOptions({}))
  const session = createSession(sessionFixtureOptions({ publicClient }))

  const snapshot = await session.load()

  assert.equal(snapshot.route, BIKE_ROUTE_ENTRY)
  assert.equal(snapshot.screenURI, entryScreenURI)
  assert.equal(snapshot.resolvedScreen.title, "Entry")
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

test("snapshot returns isolated copies of nested route and resolved screen data", async () => {
  const session = createSession(sessionFixtureOptions({
    loadResource: createResourceLoader(bikeResourceBytes({
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
    })),
  }))

  const snapshot = await session.load()

  mutableRecord(snapshot.values[0]).accountInfo = "mutated route value"
  mutableRecord(mutableRecord(snapshot.resolvedScreen.elements[0]).value).accountInfo = "mutated resolved value"

  const nextSnapshot = session.snapshot()
  assert.equal(mutableRecord(nextSnapshot.values?.[0]).accountInfo, "Mock registrar account")
  assert.equal(
    mutableRecord(mutableRecord(nextSnapshot.resolvedScreen?.elements[0]).value).accountInfo,
    "Mock registrar account",
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
  let entryScreenLoads = 0
  const resources = createResourceLoader(bikeResourceBytes({}))
  const session = createSession(sessionFixtureOptions({
    loadResource: async (uri) => {
      if (uri === entryScreenURI) {
        entryScreenLoads += 1
        if (entryScreenLoads > 1) {
          throw new Error("entry reload failed")
        }
      }

      return await resources(uri)
    },
  }))

  const before = await session.load()

  await assert.rejects(
    () => session.setAccount({ address: otherUserAddress }),
    (error) => error instanceof CamViewerError && error.code === "CAM_VIEWER_SCREEN_LOAD_FAILED",
  )

  assert.deepEqual(session.snapshot(), before)
})

test("updateForm resolves navigation actions, while contract actions are surfaced without sending", async () => {
  const publicClient = createPublicClient(publicClientFixtureOptions({}))
  const session = createSession(sessionFixtureOptions({
    publicClient,
    loadResource: createResourceLoader(bikeResourceBytes({
      [entryScreenURI]: encodeJson({
        screen: "1.0.0",
        title: "Entry",
        elements: [
          {
            type: "input",
            name: "serialNumber",
            label: "Serial number",
            value: "",
          },
          {
            type: "button",
            label: "Look up",
            action: {
              type: "navigate",
              route: BIKE_ROUTE_COMPONENT,
              params: {
                serialNumber: "$form.serialNumber",
              },
            },
          },
        ],
      }),
    })),
  }))
  await session.load()

  const snapshot = session.updateForm({
    serialNumber: BIKE_SERIAL_NUMBER,
  })

  assert.deepEqual(snapshot.resolvedScreen.elements[0], inert({
    type: "input",
    name: "serialNumber",
    label: "Serial number",
    value: BIKE_SERIAL_NUMBER,
  }))
  assert.deepEqual(snapshot.resolvedScreen.elements[1], inert({
    type: "button",
    label: "Look up",
    action: {
      type: "navigate",
      route: BIKE_ROUTE_COMPONENT,
      params: {
        serialNumber: BIKE_SERIAL_NUMBER,
      },
    },
  }))

  const button = snapshot.resolvedScreen.elements[1]
  assert.equal(button.type, "button")
  if (button.type !== "button") {
    assert.fail("expected resolved button")
  }

  const result = await session.dispatchAction(button.action)

  assert.equal(result.type, "navigated")
  if (result.type !== "navigated") {
    assert.fail("expected navigation action result")
  }
  assert.equal(result.snapshot.route, BIKE_ROUTE_COMPONENT)
  assert.equal(result.snapshot.params.serialNumber, BIKE_SERIAL_NUMBER)
  assert.equal(result.snapshot.screenURI, componentScreenURI)
  assert.equal(publicClient.calls.at(-1)?.functionName, BIKE_VIEW_COMPONENT)
  assert.deepEqual(publicClient.calls.at(-1)?.args, [BIKE_SERIAL_NUMBER, userAddress])

  const callsBefore = publicClient.calls.length

  const action = {
    type: "contract-call",
    contract: BIKE_MANAGER_CONTRACT,
    function: BIKE_MARK_MISSING,
    args: [BIKE_SERIAL_NUMBER],
  } as const
  const contractResult = await session.dispatchAction(action)

  assert.equal(contractResult.type, "contractCall")
  assert.equal(contractResult.call.contract, BIKE_MANAGER_CONTRACT)
  assert.equal(contractResult.call.address, managerAddress)
  assert.equal(contractResult.call.function, BIKE_MARK_MISSING)
  assert.deepEqual(contractResult.call.abi, toInertValue(bikeManagerAbi))
  assert.deepEqual(contractResult.call.args, [BIKE_SERIAL_NUMBER])
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
    params: {},
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
