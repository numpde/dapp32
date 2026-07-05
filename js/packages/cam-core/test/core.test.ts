import assert from "node:assert/strict"
import test from "node:test"
import {
  collectCamNamespaceFacts,
  collectCamResourceDeclarationFacts,
  collectCamRootFact,
  toInertValue,
} from "@cam/protocol"

import {
  CamError,
  createContext,
  parseCam,
  routeRequiresAccount,
  resolveRouteCall,
  resolveRouteThen,
} from "../src/index.ts"
import type { CamDocument } from "../src/index.ts"
import {
  BIKE_ACCOUNT_ADDRESS,
  BIKE_HOST_ADDRESS,
  BIKE_HOST_CHAIN_ID,
  BIKE_MANAGER_NAMESPACE,
  BIKE_ROUTE_COMPONENT,
  BIKE_SERIAL_NUMBER,
  BIKE_UI_NAMESPACE,
  BIKE_VIEW_COMPONENT,
} from "../../../../tests/fixtures/cam/bike.mts"
import { bikeCamJson as mainJson } from "../../../../tests/fixtures/cam/bike-resources.mts"

const ZERO_SHA256_INTEGRITY = "sha256:0x0000000000000000000000000000000000000000000000000000000000000000"

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

test("route account preflight follows protocol expression traversal", () => {
  const anonymousCam = parseCam({
    ...mainJson,
    routes: {
      ...mainJson.routes,
      entry: {
        ...mainJson.routes.entry,
        call: {
          ...mainJson.routes.entry.call,
          args: {
            account: "$$account.address",
          },
        },
      },
    },
  })
  assert.equal(routeRequiresAccount(anonymousCam, "entry"), false)

  class NonProtocolBox {
    readonly value = "$account.address"
  }

  const forgedCam = {
    ...anonymousCam,
    routes: {
      ...anonymousCam.routes,
      entry: {
        ...anonymousCam.routes.entry,
        call: {
          ...anonymousCam.routes.entry.call,
          args: {
            box: new NonProtocolBox(),
          } as unknown as Record<string, never>,
        },
      },
    },
  } satisfies CamDocument

  // Preflight mirrors expression runtime traversal: JSON records and arrays
  // only. Non-protocol objects can be rejected by parsers, but are not walked
  // here because this helper is not an alternate object introspection engine.
  assert.equal(routeRequiresAccount(forgedCam, "entry"), false)
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

test("parseCam rejects structurally invalid route input declarations", () => {
  const cases: readonly {
    readonly inputs: unknown
    readonly path: string
  }[] = [
    {
      inputs: null,
      path: "routes.entry.inputs",
    },
    {
      inputs: [""],
      path: "routes.entry.inputs.0",
    },
    {
      inputs: [1],
      path: "routes.entry.inputs.0",
    },
    {
      inputs: ["serial-number"],
      path: "routes.entry.inputs.0",
    },
    {
      inputs: ["serialNumber", "serialNumber"],
      path: "routes.entry.inputs.1",
    },
    {
      inputs: ["", "serial-number"],
      path: "routes.entry.inputs.0",
    },
  ]

  for (const item of cases) {
    assert.throws(
      () => parseCam({
        ...mainJson,
        routes: {
          ...mainJson.routes,
          entry: {
            ...mainJson.routes.entry,
            inputs: item.inputs,
          },
        },
      }),
      (error) =>
        error instanceof CamError
        && error.code === "CAM_INVALID_FIELD"
        && error.path === item.path,
    )
  }
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

test("parseCam rejects structurally invalid route invocations", () => {
  const cases: readonly {
    readonly route: "entry" | "registerComponent"
    readonly edge: "call" | "then"
    readonly value: unknown
    readonly path: string
  }[] = [
    {
      route: "entry",
      edge: "call",
      value: null,
      path: "routes.entry.call",
    },
    {
      route: "entry",
      edge: "call",
      value: {
        namespace: "contracts.Missing",
        function: "viewEntry",
        args: {},
      },
      path: "routes.entry.call.namespace",
    },
    {
      route: "entry",
      edge: "then",
      value: {
        namespace: "routes",
        function: "entry",
        args: {},
      },
      path: "routes.entry.then.namespace",
    },
    {
      route: "registerComponent",
      edge: "then",
      value: {
        namespace: "ui",
        function: "app",
        args: {},
      },
      path: "routes.registerComponent.then.namespace",
    },
    {
      route: "entry",
      edge: "call",
      value: {
        namespace: BIKE_UI_NAMESPACE,
        args: {},
      },
      path: "routes.entry.call.function",
    },
    {
      route: "entry",
      edge: "call",
      value: {
        namespace: BIKE_UI_NAMESPACE,
        function: "viewEntry",
        args: [],
      },
      path: "routes.entry.call.args",
    },
    {
      route: "entry",
      edge: "call",
      value: {
        namespace: BIKE_UI_NAMESPACE,
        function: "viewEntry",
        args: {
          "": "$account.address",
        },
      },
      path: "routes.entry.call.args",
    },
  ]

  for (const item of cases) {
    assert.throws(
      () => parseCam({
        ...mainJson,
        routes: {
          ...mainJson.routes,
          [item.route]: {
            ...mainJson.routes[item.route],
            [item.edge]: item.value,
          },
        },
      }),
      (error) =>
        error instanceof CamError
        && error.code === "CAM_INVALID_FIELD"
        && error.path === item.path,
    )
  }
})

test("parseCam gives invocation fact diagnostic order precedence for mixed-invalid invocations", () => {
  assert.throws(
    () => parseCam({
      ...mainJson,
      routes: {
        ...mainJson.routes,
        entry: {
          ...mainJson.routes.entry,
          call: {
            namespace: "",
            function: "",
            args: [],
          },
        },
      },
    }),
    (error) =>
      error instanceof CamError
      && error.code === "CAM_INVALID_FIELD"
      && error.path === "routes.entry.call.function",
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
          integrity: ZERO_SHA256_INTEGRITY,
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
        "contracts.Manager-v1": {
          type: "contract",
          abiURI: "./abi/Manager.json",
          integrity: ZERO_SHA256_INTEGRITY,
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

test("parseCam preserves namespace unknown-field precedence over resource diagnostics", () => {
  const namespaces = mainJson.namespaces as Record<string, Record<string, unknown>>

  assert.throws(
    () => parseCam({
      ...mainJson,
      namespaces: {
        ...namespaces,
        ui: {
          ...namespaces.ui,
          extra: true,
          uri: "../ui.json",
        },
      },
    }),
    (error) =>
      error instanceof CamError
      && error.code === "CAM_UNKNOWN_FIELD"
      && error.path === "namespaces.ui.extra",
  )
})

test("parseCam gives namespace fact diagnostics precedence over runtime namespace unknown fields", () => {
  const namespaces = mainJson.namespaces as Record<string, Record<string, unknown>>

  assert.throws(
    () => parseCam({
      ...mainJson,
      namespaces: {
        ...namespaces,
        [BIKE_MANAGER_NAMESPACE]: {
          ...namespaces[BIKE_MANAGER_NAMESPACE],
          extra: true,
        },
        bad: {
          type: "widget",
        },
      },
    }),
    (error) =>
      error instanceof CamError
      && error.code === "CAM_INVALID_FIELD"
      && error.path === "namespaces.bad.type",
  )
})

test("parseCam and protocol facts share root namespace resource declaration meaning", () => {
  const cam = parseCam(mainJson)
  const rootResult = collectCamRootFact(mainJson, { resource: "bike fixture" })
  assert.deepEqual(rootResult.diagnostics, [])
  assert.notEqual(rootResult.value, undefined)

  const namespaceResult = collectCamNamespaceFacts(rootResult.value!)
  assert.deepEqual(namespaceResult.diagnostics, [])
  assert.deepEqual(
    namespaceResult.namespaces.map((namespace) => [namespace.name, namespace.type]),
    Object.entries(cam.namespaces).map(([name, namespace]) => [name, namespace.type]),
  )

  const resourceResult = collectCamResourceDeclarationFacts(namespaceResult.namespaces)
  assert.deepEqual(resourceResult.diagnostics, [])
  const managerNamespace = cam.namespaces[BIKE_MANAGER_NAMESPACE]
  const uiContractNamespace = cam.namespaces[BIKE_UI_NAMESPACE]
  const uiNamespace = cam.namespaces.ui
  if (managerNamespace.type !== "contract") throw new Error("bike manager namespace must be a contract")
  if (uiContractNamespace.type !== "contract") throw new Error("bike UI contract namespace must be a contract")
  if (uiNamespace.type !== "ui") throw new Error("bike UI namespace must be ui")
  const managerFact = namespaceResult.namespaces.find((namespace) => namespace.name === BIKE_MANAGER_NAMESPACE)
  const uiContractFact = namespaceResult.namespaces.find((namespace) => namespace.name === BIKE_UI_NAMESPACE)
  const uiFact = namespaceResult.namespaces.find((namespace) => namespace.name === "ui")
  if (managerFact === undefined) throw new Error("bike manager namespace fact must exist")
  if (uiContractFact === undefined) throw new Error("bike UI contract namespace fact must exist")
  if (uiFact === undefined) throw new Error("bike UI namespace fact must exist")
  assert.deepEqual(
    resourceResult.declarations.map((declaration) => ({
      namespace: declaration.namespace,
      namespaceType: declaration.namespaceType,
      uri: declaration.uri,
      integrity: declaration.integrity,
      uriPath: declaration.uriPath,
      integrityPath: declaration.integrityPath,
    })),
    [
      {
        namespace: BIKE_UI_NAMESPACE,
        namespaceType: "contract",
        uri: uiContractNamespace.abiURI,
        integrity: uiContractNamespace.integrity,
        uriPath: `${uiContractFact.path}.abiURI`,
        integrityPath: `${uiContractFact.path}.integrity`,
      },
      {
        namespace: BIKE_MANAGER_NAMESPACE,
        namespaceType: "contract",
        uri: managerNamespace.abiURI,
        integrity: managerNamespace.integrity,
        uriPath: `${managerFact.path}.abiURI`,
        integrityPath: `${managerFact.path}.integrity`,
      },
      {
        namespace: "ui",
        namespaceType: "ui",
        uri: uiNamespace.uri,
        integrity: uiNamespace.integrity,
        uriPath: `${uiFact.path}.uri`,
        integrityPath: `${uiFact.path}.integrity`,
      },
    ],
  )
})
