import assert from "node:assert/strict"
import test from "node:test"

import {
  CAM_VERSION,
  toInertValue,
} from "@cam/protocol"

import {
  CamError,
  createContext,
  parseCam,
  resolveRouteCall,
  routeRequiresAccount,
} from "../src/index.ts"

const HOST = {
  chainId: "eip155:31337",
  address: "0x0000000000000000000000000000000000000001",
} as const
const ACCOUNT = "0x0000000000000000000000000000000000000002"

function camDocument({
  value,
  routeKind,
}: {
  readonly value: unknown
  readonly routeKind: "read" | "write"
}): Record<string, unknown> {
  const route = routeKind === "write"
    ? {
        kind: "write",
        inputs: ["amount"],
        value,
        call: {
          namespace: "contracts.App",
          function: "pay",
          args: {},
        },
        then: {
          namespace: "routes",
          function: "entry",
          args: {},
        },
      }
    : {
        kind: "read",
        inputs: [],
        value,
        call: {
          namespace: "contracts.App",
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
      }

  return {
    cam: CAM_VERSION,
    protocol: { uri: "./protocol.html", integrity: "sha256:fixture" },
    entry: "entry",
    namespaces: {
      "contracts.App": {
        type: "contract",
        abiURI: "./abi/App.json",
        integrity: "sha256:fixture",
      },
      routes: {
        type: "routes",
      },
      ui: {
        type: "ui",
        uri: "./ui.json",
        integrity: "sha256:fixture",
      },
    },
    routes: {
      entry: {
        kind: "read",
        inputs: [],
        call: {
          namespace: "contracts.App",
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
      valueRoute: route,
    },
  }
}

test("CAM 1.2 parses and resolves write-route value expressions", () => {
  const cam = parseCam(camDocument({
    value: "$inputs.amount",
    routeKind: "write",
  }))
  const route = cam.routes.valueRoute
  assert.equal(route.kind, "write")
  assert.equal(route.kind === "write" ? route.value : undefined, "$inputs.amount")

  const call = resolveRouteCall(cam, "valueRoute", createContext({
    host: HOST,
    account: { address: ACCOUNT },
    inputs: { amount: "1000000000000000000" },
    outputs: [],
  }))
  assert.deepEqual(call, {
    namespace: "contracts.App",
    function: "pay",
    args: toInertValue({}),
    value: "1000000000000000000",
  })
  assert.equal(routeRequiresAccount(cam, "valueRoute"), false)
})

test("write-route value participates in account preflight", () => {
  const document = camDocument({
    value: "$account.address",
    routeKind: "write",
  })
  const routes = document.routes as Record<string, Record<string, unknown>>
  routes.valueRoute.inputs = []
  const cam = parseCam(document)

  assert.equal(routeRequiresAccount(cam, "valueRoute"), true)
  assert.equal(resolveRouteCall(cam, "valueRoute", createContext({
    host: HOST,
    account: { address: ACCOUNT },
    inputs: {},
    outputs: [],
  })).value, ACCOUNT)
})

test("CAM 1.2 rejects transaction value on read routes", () => {
  assert.throws(
    () => parseCam(camDocument({
      value: "1",
      routeKind: "read",
    })),
    (error) =>
      error instanceof CamError
      && error.code === "CAM_UNKNOWN_FIELD"
      && error.path === "routes.valueRoute.value"
      && error.message === "routes.valueRoute.value: field is not allowed in CAM 1.2.0: value",
  )
})
