import assert from "node:assert/strict"
import test from "node:test"
import { toInertValue } from "@cam/protocol"

import {
  CamError,
  createContext,
  parseCam,
  routeRequiresAccount,
  resolveRouteCall,
  resolveRouteThen,
} from "../src/index.ts"
import {
  BIKE_ACCOUNT_ADDRESS,
  BIKE_HOST_ADDRESS,
  BIKE_HOST_CHAIN_ID,
  BIKE_ROUTE_COMPONENT,
  BIKE_SERIAL_NUMBER,
  BIKE_UI_NAMESPACE,
  BIKE_VIEW_COMPONENT,
} from "../../../../tests/fixtures/cam/bike.mts"
import { bikeCamJson as mainJson } from "../../../../tests/fixtures/cam/bike-resources.mts"

test("resolves a CAM route into a plain call descriptor", () => {
  const cam = parseCam(mainJson)
  assert.equal(routeRequiresAccount(cam, BIKE_ROUTE_COMPONENT), true)
  const context = createContext({
    host: {
      chainId: BIKE_HOST_CHAIN_ID,
      address: BIKE_HOST_ADDRESS,
    },
    account: {
      address: BIKE_ACCOUNT_ADDRESS,
    },
    inputs: {
      serialNumber: BIKE_SERIAL_NUMBER,
    },
    outputs: [],
  })

  const call = resolveRouteCall(cam, BIKE_ROUTE_COMPONENT, context)
  const then = resolveRouteThen(cam, BIKE_ROUTE_COMPONENT, createContext({
    host: {
      chainId: BIKE_HOST_CHAIN_ID,
      address: BIKE_HOST_ADDRESS,
    },
    account: {
      address: BIKE_ACCOUNT_ADDRESS,
    },
    inputs: {
      serialNumber: BIKE_SERIAL_NUMBER,
    },
    outputs: [{
      viewId: "component.found",
    }],
  }))

  assert.deepEqual(call, {
    namespace: BIKE_UI_NAMESPACE,
    function: BIKE_VIEW_COMPONENT,
    args: toInertValue({
      serialNumber: BIKE_SERIAL_NUMBER,
      account: BIKE_ACCOUNT_ADDRESS,
    }),
  })
  assert.deepEqual(then, {
    namespace: "ui",
    function: "app",
    args: toInertValue({
      view: {
        viewId: "component.found",
      },
    }),
  })
})

test("rejects invalid CAM versions and unresolved route expressions", () => {
  assert.throws(
    () => parseCam({
      ...mainJson,
      cam: "2.0.0",
    }),
    (error) => error instanceof CamError && error.code === "CAM_INVALID_FIELD",
  )
  assert.throws(
    () => parseCam({
      ...mainJson,
      unexpected: true,
    }),
    (error) => error instanceof CamError && error.code === "CAM_UNKNOWN_FIELD",
  )
  assert.throws(
    () => parseCam({
      ...mainJson,
      routes: {
        ...mainJson.routes,
        entry: {
          ...mainJson.routes.entry,
          inputs: ["serial-number"],
        },
      },
    }),
    /input name must be an expression identifier: serial-number/,
  )

  const cam = parseCam(mainJson)
  const context = createContext({
    host: {
      chainId: "eip155:31337",
      address: "0x0000000000000000000000000000000000000001",
    },
    inputs: {
      serialNumber: "ABC123",
    },
    outputs: [],
  })

  assert.throws(
    () => resolveRouteCall(cam, "component", context),
    (error) => error instanceof CamError && error.code === "CAM_UNRESOLVED_VALUE",
  )
})

test("enforces declared route inputs before resolving route calls", () => {
  const cam = parseCam(mainJson)
  const baseContext = {
    host: {
      chainId: BIKE_HOST_CHAIN_ID,
      address: BIKE_HOST_ADDRESS,
    },
    account: {
      address: BIKE_ACCOUNT_ADDRESS,
    },
    outputs: [],
  }

  assert.throws(
    () => resolveRouteCall(cam, BIKE_ROUTE_COMPONENT, createContext({
      ...baseContext,
      inputs: {},
    })),
    /missing route input: serialNumber/,
  )

  assert.throws(
    () => resolveRouteThen(cam, BIKE_ROUTE_COMPONENT, createContext({
      ...baseContext,
      inputs: {
        serialNumber: BIKE_SERIAL_NUMBER,
        typo: "ignored",
      },
    })),
    /unexpected route input: typo/,
  )
})

test("parseCam rejects route invocations with invalid namespace kinds", () => {
  assert.throws(
    () => parseCam({
      ...mainJson,
      routes: {
        ...mainJson.routes,
        entry: {
          ...mainJson.routes.entry,
          call: {
            ...mainJson.routes.entry.call,
            namespace: "ui",
          },
        },
      },
    }),
    (error) => error instanceof CamError && error.code === "CAM_INVALID_FIELD",
  )

  assert.throws(
    () => parseCam({
      ...mainJson,
      routes: {
        ...mainJson.routes,
        entry: {
          ...mainJson.routes.entry,
          then: {
            ...mainJson.routes.entry.then,
            namespace: BIKE_UI_NAMESPACE,
          },
        },
      },
    }),
    (error) => error instanceof CamError && error.code === "CAM_INVALID_FIELD",
  )
})

test("parseCam enforces canonical namespace names and route kinds", () => {
  const namespaces = mainJson.namespaces as Record<string, unknown>

  assert.throws(
    () => parseCam({
      ...mainJson,
      namespaces: {
        ...namespaces,
        screens: {
          type: "ui",
          uri: "./ui.json",
          integrity: "sha256:0x0000000000000000000000000000000000000000000000000000000000000000",
        },
      },
    }),
    /ui namespace must be named ui/,
  )

  assert.throws(
    () => parseCam({
      ...mainJson,
      namespaces: {
        ...namespaces,
        Manager: {
          type: "contract",
          abiURI: "./abi/Manager.json",
          integrity: "sha256:0x0000000000000000000000000000000000000000000000000000000000000000",
        },
      },
    }),
    /contract namespace must be contracts\.<name>/,
  )

  assert.throws(
    () => parseCam({
      ...mainJson,
      routes: {
        ...mainJson.routes,
        entry: {
          ...mainJson.routes.entry,
          kind: "write",
        },
      },
    }),
    /invalid ui namespace/,
  )

  assert.throws(
    () => parseCam({
      ...mainJson,
      routes: {
        ...mainJson.routes,
        registerComponent: {
          ...mainJson.routes.registerComponent,
          kind: "read",
        },
      },
    }),
    /invalid routes namespace/,
  )
})

test("parseCam rejects non-canonical secondary resource URIs", () => {
  const namespaces = mainJson.namespaces as Record<string, Record<string, unknown>>

  assert.throws(
    () => parseCam({
      ...mainJson,
      namespaces: {
        ...namespaces,
        [BIKE_UI_NAMESPACE]: {
          ...namespaces[BIKE_UI_NAMESPACE],
          abiURI: "https://example.test/BicycleComponentManagerUI.json",
        },
      },
    }),
    (error) => error instanceof CamError && error.code === "CAM_INVALID_URI",
  )

  assert.throws(
    () => parseCam({
      ...mainJson,
      namespaces: {
        ...namespaces,
        ui: {
          ...namespaces.ui,
          uri: "../ui.json",
        },
      },
    }),
    (error) => error instanceof CamError && error.code === "CAM_INVALID_URI",
  )
})
