import assert from "node:assert/strict"
import test from "node:test"

import {
  CAM_VERSION,
  UI_VERSION,
} from "@cam/protocol"

import {
  validateCamBundle,
} from "../src/index.ts"
import {
  issueLocations,
  issueRules,
  jsonBytes,
  replaceBundleResources,
  validateEditedRoot,
  viewEntryFunction,
} from "./fixtures.ts"
import type {
  RootWithNamespacesAndRoutes,
} from "./fixtures.ts"

type WriteRouteOptions = {
  readonly version: "1.0.0" | "1.1.0"
  readonly functionName: "fund" | "save"
  readonly includeValue: boolean
  readonly value: unknown
}

const DEFAULT_WRITE_ROUTE_OPTIONS = {
  version: CAM_VERSION,
  functionName: "fund",
  includeValue: true,
  value: "$inputs.amount",
} satisfies WriteRouteOptions

function writeRouteOptions(overrides: Partial<WriteRouteOptions>): WriteRouteOptions {
  return {
    ...DEFAULT_WRITE_ROUTE_OPTIONS,
    ...overrides,
  }
}

function payableAbiBytes() {
  return jsonBytes([
    viewEntryFunction(),
    {
      type: "function",
      name: "fund",
      stateMutability: "payable",
      inputs: [],
      outputs: [],
    },
    {
      type: "function",
      name: "save",
      stateMutability: "nonpayable",
      inputs: [],
      outputs: [],
    },
  ])
}

function addWriteRoute(
  root: RootWithNamespacesAndRoutes & Record<string, unknown>,
  options: WriteRouteOptions,
): void {
  const {
    version,
    functionName,
    includeValue,
    value,
  } = options
  root.cam = version
  root.routes.write = {
    kind: "write",
    inputs: ["amount"],
    ...(includeValue ? { value } : {}),
    call: {
      namespace: "contracts.App",
      function: functionName,
      args: {},
    },
    then: {
      namespace: "routes",
      function: "entry",
      args: {},
    },
  }
}

function validateWriteRoute(options: WriteRouteOptions) {
  return validateEditedRoot<RootWithNamespacesAndRoutes & Record<string, unknown>>((root, bundle) => {
    addWriteRoute(root, options)
    return replaceBundleResources(root, bundle, {
      abiBytes: payableAbiBytes(),
    })
  })
}

test("CAM 1.1 accepts explicit value on payable writes", () => {
  assert.deepEqual(validateWriteRoute(writeRouteOptions({})), [])
  assert.deepEqual(validateWriteRoute(writeRouteOptions({ value: "0" })), [])
})

test("CAM 1.1 requires value for payable writes", () => {
  assert.deepEqual(issueLocations(validateWriteRoute(writeRouteOptions({ includeValue: false }))), [
    ["CAM_ROUTE_VALUE_MISMATCH", "routes.write.value"],
  ])
})

test("CAM 1.1 forbids value on nonpayable writes", () => {
  assert.deepEqual(issueLocations(validateWriteRoute(writeRouteOptions({ functionName: "save" }))), [
    ["CAM_ROUTE_VALUE_MISMATCH", "routes.write.value"],
  ])
})

test("CAM 1.1 checks known transaction values as uint256", () => {
  for (const value of [
    "-1",
    "115792089237316195423570985008687907853269984665640564039457584007913129639936",
    true,
    "0x01",
  ]) {
    assert.deepEqual(issueLocations(validateWriteRoute(writeRouteOptions({ value }))), [
      ["CAM_ROUTE_VALUE_MISMATCH", "routes.write.value"],
    ], String(value))
  }
})

test("CAM 1.0 and read routes reject value at the grammar boundary", () => {
  assert.deepEqual(issueLocations(validateWriteRoute(writeRouteOptions({
    version: "1.0.0",
    functionName: "save",
  }))), [
    ["CAM_ROUTE_DECLARATION_INVALID", "routes.write.value"],
  ])

  const readIssues = validateEditedRoot<RootWithNamespacesAndRoutes & Record<string, unknown>>((root) => {
    root.cam = CAM_VERSION
    root.routes.entry.value = "0"
  })
  assert.deepEqual(issueLocations(readIssues), [
    ["CAM_ROUTE_DECLARATION_INVALID", "routes.entry.value"],
  ])
})

test("CAM 1.1 validates transaction-value expression references", () => {
  assert.deepEqual(issueLocations(validateWriteRoute(writeRouteOptions({ value: "$outputs.0" }))), [
    ["CAM_ROUTE_EXPRESSION_INVALID", "routes.write.value"],
  ])
  assert.deepEqual(issueLocations(validateWriteRoute(writeRouteOptions({ value: "$inputs.missing" }))), [
    ["CAM_ROUTE_EXPRESSION_INVALID", "routes.write.value"],
  ])
})

test("UI typeflow follows projected values into transaction value", () => {
  assert.deepEqual(validateUiValueTypeflow("uint256"), [])
  assert.equal(issueRules(validateUiValueTypeflow("address")).includes("CAM_UI_TYPEFLOW_MISMATCH"), true)
  assert.equal(issueRules(validateUiValueTypeflow("bool")).includes("CAM_UI_TYPEFLOW_MISMATCH"), true)
})

test("bundle validation still rejects unsupported versions before value semantics", () => {
  assert.deepEqual(issueLocations(validateCamBundle({
    rootURI: "cam",
    rootBytes: jsonBytes({ cam: "2.0.0" }),
    resources: new Map(),
  })), [
    ["CAM_MANIFEST_VERSION_INVALID", "cam"],
  ])
})

function validateUiValueTypeflow(amountType: "uint256" | "address" | "bool") {
  const abiBytes = jsonBytes([
    {
      type: "function",
      name: "viewEntry",
      stateMutability: "view",
      inputs: [],
      outputs: [{
        name: "view",
        type: "tuple",
        components: [{ name: "amount", type: amountType }],
      }],
    },
    {
      type: "function",
      name: "fund",
      stateMutability: "payable",
      inputs: [],
      outputs: [],
    },
  ])
  const uiBytes = jsonBytes({
    ui: UI_VERSION,
    nodes: {
      app: {
        element: "Fragment",
        requires: ["view"],
        children: [{
          element: "Button",
          props: { label: "Fund" },
          call: {
            namespace: "routes",
            function: "fund",
            args: { amount: "$view.amount" },
          },
        }],
      },
    },
  })

  return validateEditedRoot<RootWithNamespacesAndRoutes & Record<string, unknown>>((root, bundle) => {
    root.cam = CAM_VERSION
    root.routes.fund = {
      kind: "write",
      inputs: ["amount"],
      value: "$inputs.amount",
      call: {
        namespace: "contracts.App",
        function: "fund",
        args: {},
      },
      then: {
        namespace: "routes",
        function: "entry",
        args: {},
      },
    }
    return replaceBundleResources(root, bundle, { abiBytes, uiBytes })
  })
}
