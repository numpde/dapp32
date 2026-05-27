import assert from "node:assert/strict"
import test from "node:test"

import { CamEvmError } from "@cam/evm-viem"
import { toInertValue } from "@cam/protocol"
import type { InertRecord, InertValue } from "@cam/protocol"

import * as camViewer from "../src/index.ts"
import {
  CamViewerError,
  createCamViewerSession,
} from "../src/index.ts"
import type {
  CamHost,
} from "@cam/evm-viem"
import type { CreateCamViewerSessionOptions } from "../src/index.ts"
import type { Address, Hex } from "viem"
import {
  BIKE_ACCOUNT_ADDRESS as userAddress,
  BIKE_CAM_URI as camURI,
  BIKE_COMPONENT_SCREEN_URI as componentScreenURI,
  BIKE_ENTRY_SCREEN_URI as entryScreenURI,
  BIKE_MARK_MISSING,
  BIKE_MANAGER_CONTRACT,
  BIKE_REGISTER_SCREEN_URI as registerScreenURI,
  BIKE_RELATIVE_ENTRY_SCREEN_URI,
  BIKE_ROUTE_COMPONENT,
  BIKE_ROUTE_ENTRY,
  BIKE_ROUTE_REGISTER,
  BIKE_SERIAL_NUMBER,
  BIKE_UNSIGNED_CAM_HASH,
  BIKE_VIEW_COMPONENT,
  BIKE_VIEW_ENTRY,
  bikeContractAddresses,
  bikeHost,
  bikeRouteResults,
} from "../../../tests/fixtures/cam/bike.mts"
import {
  bikeResourceBytes,
  createMockCamPublicClient,
  createMockResourceLoader as createResourceLoader,
  encodeJson,
} from "../../../tests/fixtures/cam/mock.mts"

const host: CamHost = bikeHost

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

test("updateForm updates screen form without calling a route", async () => {
  const publicClient = createPublicClient()
  const session = createSession({ publicClient })
  await session.load()
  const callsBefore = publicClient.calls.length

  const snapshot = session.updateForm({
    serialNumber: BIKE_SERIAL_NUMBER,
  })

  assert.equal(requireForm(snapshot).serialNumber, BIKE_SERIAL_NUMBER)
  assert.equal(publicClient.calls.length, callsBefore)
})

test("updateForm re-resolves current screen actions with updated form", async () => {
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
            value: "",
          },
          {
            type: "button",
            label: "Look up",
            action: {
              route: BIKE_ROUTE_COMPONENT,
              params: {
                serialNumber: "$form.serialNumber",
              },
            },
          },
        ],
      }),
    },
  })
  await session.load()

  const snapshot = session.updateForm({
    serialNumber: BIKE_SERIAL_NUMBER,
  })

  assert.deepEqual(snapshot.resolvedScreen?.elements[0], inert({
    type: "input",
    name: "serialNumber",
    label: "Serial number",
    value: BIKE_SERIAL_NUMBER,
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

test("updateForm and navigate copy caller-owned nested input records", async () => {
  const session = createSession({
    resources: {
      [entryScreenURI]: encodeJson({
        screen: "1.0.0",
        elements: [
          {
            type: "input",
            name: "nested",
            label: "Nested",
            value: {
              value: "initial",
            },
          },
        ],
      }),
    },
  })
  await session.load()

  const patch = {
    nested: {
      value: "before",
    },
  }
  const formSnapshot = session.updateForm(patch)
  patch.nested.value = "after"
  mutableRecord(requireForm(formSnapshot).nested).value = "snapshot mutation"

  assert.equal(mutableRecord(requireForm(session.snapshot()).nested).value, "before")

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

test("updateForm rejects fields not declared by the current screen", async () => {
  const session = createSession()
  await session.load()

  assert.throws(
    () => session.updateForm({ unknown: "value" }),
    (error) => error instanceof CamViewerError && error.code === "CAM_VIEWER_UNKNOWN_FORM_FIELD",
  )
})

test("updateForm rejects unsupported mutable object values instead of storing live references", async () => {
  const session = createSession()
  await session.load()

  assert.throws(
    () => session.updateForm({ date: new Date(0) as unknown as InertValue }),
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

test("updateForm rejects before a screen is loaded", () => {
  const session = createSession()

  assert.throws(
    () => session.updateForm({ serialNumber: BIKE_SERIAL_NUMBER }),
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
}: {
  readonly publicClient?: ReturnType<typeof createPublicClient>
  readonly resources?: Record<string, Uint8Array>
} = {}) {
  return createCamViewerSession({
    publicClient,
    host,
    account: { address: userAddress },
    params: {},
    allowUnsignedCamHash: true,
    loadResource: createResourceLoader(bikeResourceBytes(resources)),
  })
}

function createPublicClient({
  // These are viewer test defaults, not protocol defaults. Tests override them
  // when hash, binding, or route output behavior is under scrutiny.
  camHash = BIKE_UNSIGNED_CAM_HASH,
  addresses = bikeContractAddresses,
  routeResults = bikeRouteResults(BIKE_SERIAL_NUMBER, userAddress),
}: {
  readonly camHash?: Hex
  readonly addresses?: Readonly<Record<string, Address>>
  readonly routeResults?: Record<string, unknown>
} = {}) {
  // This fake models raw viem return values before @cam/evm-viem normalizes
  // them to RouteResult.values.
  return createMockCamPublicClient<CreateCamViewerSessionOptions["publicClient"]["readContract"]>({
    camURI,
    camHash,
    addresses,
    routeResults,
    hostAddress: host.address,
  })
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

function requireForm(snapshot: { readonly form?: InertRecord }): InertRecord {
  const form = snapshot.form
  if (form === undefined) {
    assert.fail("expected loaded viewer form")
  }

  return form
}
