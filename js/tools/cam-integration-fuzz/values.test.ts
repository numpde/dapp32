import assert from "node:assert/strict"
import test from "node:test"

import type {
  CamRoute,
} from "../../packages/cam-core/dist/index.js"
import type { ResolvedCamContract } from "../../packages/cam-evm-viem/dist/index.js"
import { UI_VERSION } from "../../packages/cam-protocol/dist/index.js"
import type { UiDocument } from "../../packages/cam-screen/dist/index.js"
import type { CamViewerSnapshot } from "../../packages/cam-viewer/dist/index.js"
import type {
  Address,
} from "viem"
import type {
  Prng,
} from "./prng.ts"
import {
  generatedRouteInputs,
  generatedStatePatch,
} from "./values.ts"

const account = "0x0000000000000000000000000000000000000001" as Address
const contracts: Record<string, ResolvedCamContract> = { "contracts.Fixture": { address: account, abi: [
  { type: "function", name: "inspect", stateMutability: "view", inputs: [{ name: "who", type: "address" }, { name: "seconds", type: "uint256" }], outputs: [] },
  { type: "function", name: "inspect", stateMutability: "view", inputs: [{ name: "who", type: "string" }], outputs: [] },
] } }
const typedRoute: CamRoute = { ...routeWithInputs(["unrelatedName", "timeCode"]), call: {
  namespace: "contracts.Fixture", function: "inspect(address,uint256)", args: { who: "$inputs.unrelatedName", seconds: "$inputs.timeCode" },
} }
const emptyUi: UiDocument = { ui: UI_VERSION, nodes: {} }

test("broad value generation keeps invalid empty strings in the read-only corpus", () => {
  assert.deepEqual(
    plainRecord(generatedRouteInputs({
      route: routeWithInputs(["serialNumber", "note"]),
      contracts,
      account,
      prng: firstValuePrng(),
      mode: "broad",
    })),
    {
      serialNumber: "",
      note: "",
    },
  )
})

test("write-positive value generation avoids known-invalid empty strings", () => {
  assert.deepEqual(
    plainRecord(generatedRouteInputs({
      route: routeWithInputs(["serialNumber", "note"]),
      contracts,
      account,
      prng: firstValuePrng(),
      mode: "write-positive",
    })),
    {
      serialNumber: "CAM-TEST-001",
      note: "CAM-TEST-001",
    },
  )
})

test("value generation treats account and URI-like names as protocol fixtures", () => {
  assert.deepEqual(
    plainRecord(generatedRouteInputs({
      route: routeWithInputs(["ownerAddress", "metadataURI"]),
      contracts,
      account,
      prng: firstValuePrng(),
      mode: "broad",
    })),
    {
      ownerAddress: account,
      metadataURI: "fixture://cam-integration/1.json",
    },
  )
})

test("state fuzzing includes dedicated integer controls and excludes disabled controls", () => {
  const patch = generatedStatePatch({ snapshot: {
    canGoBack: false, inputs: {}, state: {}, resolvedUi: { element: "Fragment", props: {}, children: [
      { element: "DurationField", props: { label: "Duration" }, state: { key: "duration" }, draft: { parts: { days: { text: "", status: "empty" }, hours: { text: "", status: "empty" }, minutes: { text: "", status: "empty" }, seconds: { text: "", status: "empty" } }, status: "empty" }, children: [] },
      { element: "NonNegativeIntegerField", props: { label: "Counter" }, state: { key: "counter" }, draft: { text: "", status: "empty" }, children: [] },
      { element: "NonNegativeIntegerField", props: { label: "Disabled counter" }, disabled: true, state: { key: "disabled" }, draft: { text: "", status: "empty" }, children: [] },
      { element: "TextField", props: { label: "Identifier" }, state: { key: "identifier" }, children: [] },
    ] },
  }, contracts, routes: {}, ui: emptyUi, account, prng: firstValuePrng(), mode: "broad" })
  assert.deepEqual(plainRecord(patch), { counter: "", duration: "", identifier: "" })
})

test("route inputs follow direct ABI bindings regardless of input names and select explicit overloads", () => {
  assert.deepEqual(plainRecord(generatedRouteInputs({ route: typedRoute, contracts, account, prng: firstValuePrng(), mode: "write-positive" })), {
    unrelatedName: account, timeCode: "1",
  })
})

test("ambiguous ABI overloads identify a generator limitation", () => {
  assert.throws(() => generatedRouteInputs({ route: { ...typedRoute, call: { ...typedRoute.call, function: "inspect" } }, contracts, account, prng: firstValuePrng(), mode: "write-positive" }), /generat.*unambiguous|generat.*overload/i)
})

test("conflicting direct ABI constraints fail rather than guessing an input type", () => {
  const route = { ...typedRoute, call: { ...typedRoute.call, args: { who: "$inputs.unrelatedName", seconds: "$inputs.unrelatedName" } } }
  assert.throws(() => generatedRouteInputs({ route, contracts, account, prng: firstValuePrng(), mode: "write-positive" }), /conflict.*unrelatedName/i)
})

test("state generation follows direct UI bindings with different field and route-input names and numeric caps", () => {
  const ui: UiDocument = { ui: UI_VERSION, nodes: { app: { element: "Button", props: {}, call: { namespace: "routes", function: "inspect", args: { unrelatedName: "$state.workshopCode", timeCode: "$state.life" } } } } }
  const patch = generatedStatePatch({ snapshot: {
    canGoBack: false, inputs: {}, state: { workshopCode: "", life: "" }, resolvedUi: { element: "Fragment", props: {}, children: [
      { element: "TextField", props: { label: "Person" }, state: { key: "workshopCode" }, children: [] },
      { element: "DurationField", props: { label: "Lifetime", min: "10", max: "120" }, state: { key: "life" }, draft: { parts: { days: { text: "", status: "empty" }, hours: { text: "", status: "empty" }, minutes: { text: "", status: "empty" }, seconds: { text: "", status: "empty" } }, status: "empty" }, children: [] },
      { element: "Button", props: {}, call: { namespace: "routes", function: "inspect", args: { unrelatedName: "", timeCode: "" } } },
    ] },
  }, contracts, routes: { inspect: typedRoute }, ui, account, prng: firstValuePrng(), mode: "write-positive" })
  assert.deepEqual(plainRecord(patch), { life: "120", workshopCode: account })
})

test("a rendered field with conflicting direct action bindings is a generator limitation", () => {
  const ui: UiDocument = { ui: UI_VERSION, nodes: { app: { element: "Button", props: {}, call: {
    namespace: "routes", function: "inspect", args: { unrelatedName: "$state.shared", timeCode: "$state.shared" },
  } } } }
  assert.throws(() => generatedStatePatch({ snapshot: {
    canGoBack: false, inputs: {}, state: { shared: "" }, resolvedUi: { element: "Fragment", props: {}, children: [
      { element: "TextField", props: { label: "Shared" }, state: { key: "shared" }, children: [] },
      { element: "Button", props: {}, call: { namespace: "routes", function: "inspect", args: {} } },
    ] },
  }, contracts, routes: { inspect: typedRoute }, ui, account, prng: firstValuePrng(), mode: "write-positive" }), /generat.*conflict.*shared/i)
})

test("an unbounded duration control respects its directly bound uint8 ABI range", () => {
  assert.equal(numericPatch("uint8", {}).life, "255")
})

test("a nonnegative duration control respects the positive range of a signed ABI integer", () => {
  assert.equal(numericPatch("int8", {}).life, "127")
})

test("a uint48 duration with the Bike-sized cap retains its generous preparation value", () => {
  assert.equal(numericPatch("uint48", { min: "1", max: "31536000" }).life, "3600")
})

test("numeric generation reports disjoint UI and ABI ranges as a generator limitation", () => {
  assert.throws(() => numericPatch("uint8", { min: "256" }), /generat.*life.*(range|bound)/i)
})

for (const [type, expected] of [["bool", false], ["bytes", "0x"], ["bytes2", "0x1111"]] as const) {
  test(`direct ${type} ABI input generation retains the declared scalar representation`, () => {
    const { route, contracts } = scalarBinding(type)
    assert.equal(generatedRouteInputs({ route, contracts, account, prng: firstValuePrng(), mode: "write-positive" }).mystery, expected)
  })
}

test("aggregate ABI input generation reports its unsupported generator boundary", () => {
  const { route, contracts } = scalarBinding("uint256[]")
  assert.throws(() => generatedRouteInputs({ route, contracts, account, prng: firstValuePrng(), mode: "write-positive" }), /generator.*scalar.*uint256\[\]/i)
})

function scalarBinding(type: string) {
  const route: CamRoute = { ...routeWithInputs(["mystery"]), call: { namespace: "contracts.Fixture", function: "inspect", args: { value: "$inputs.mystery" } } }
  const contracts: Record<string, ResolvedCamContract> = { "contracts.Fixture": { address: account, abi: [
    { type: "function", name: "inspect", stateMutability: "view", inputs: [{ name: "value", type }], outputs: [] },
  ] } }
  return { route, contracts }
}

function numericPatch(type: string, bounds: { min?: string; max?: string }) {
  const { route, contracts } = scalarBinding(type)
  const ui: UiDocument = { ui: UI_VERSION, nodes: { app: { element: "Button", props: {}, call: {
    namespace: "routes", function: "inspect", args: { mystery: "$state.life" },
  } } } }
  const snapshot: CamViewerSnapshot = { canGoBack: false, inputs: {}, state: { life: "" }, resolvedUi: { element: "Fragment", props: {}, children: [
    { element: "DurationField", props: { label: "Lifetime", ...bounds }, state: { key: "life" }, draft: { parts: { days: { text: "", status: "empty" }, hours: { text: "", status: "empty" }, minutes: { text: "", status: "empty" }, seconds: { text: "", status: "empty" } }, status: "empty" }, children: [] },
    { element: "Button", props: {}, call: { namespace: "routes", function: "inspect", args: {} } },
  ] } }
  return generatedStatePatch({ snapshot, contracts, routes: { inspect: route }, ui, account, prng: firstValuePrng(), mode: "write-positive" })
}

function plainRecord(record: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(record))
}

function routeWithInputs(inputs: readonly string[]): CamRoute {
  return {
    kind: "read",
    inputs,
    call: {
      namespace: "routes",
      function: "view",
      args: {},
    },
    then: {
      namespace: "ui",
      function: "render",
      args: {},
    },
  }
}

function firstValuePrng(): Prng {
  return {
    integer() {
      return 0
    },
    pick(values) {
      const value = values[0]
      if (value === undefined) {
        throw new Error("test PRNG cannot pick from an empty array")
      }
      return value
    },
  }
}
