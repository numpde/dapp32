import assert from "node:assert/strict"
import test from "node:test"

import { toInertValue, UI_VERSION } from "@cam/protocol"
import type { InertRecord } from "@cam/protocol"
import {
  forEachResolvedUiNode,
  parseUi,
  resolvedUiButtons,
  resolvedUiInputNames,
  resolveInitialUiNode,
  resolveUiNode,
  UiError,
} from "../src/index.ts"

const context = {
  host: {
    chainId: "eip155:31337",
    address: "0x0000000000000000000000000000000000000001",
  },
  account: {
    address: "0x0000000000000000000000000000000000000002",
  },
  inputs: {},
  outputs: [],
  state: {
    serialNumber: "ABC123",
  },
}

test("NonNegativeIntegerField keeps one exact canonical integer while preserving declared lexical defaults", () => {
  for (const value of ["", "0", "0000", "00042", "9007199254740993", "18446744073709551615", (2n ** 256n - 1n).toString()]) {
    const ui = parseUi({ ui: UI_VERSION, nodes: { counter: {
      requires: [], element: "NonNegativeIntegerField", props: { label: "Counter", min: "0" },
      state: { key: "counter", defaultValue: value },
    } } })
    const { state, resolvedUi } = resolveInitialUiNode(ui, "counter", {}, { ...context, state: {} })
    assert.equal(state.counter, value === "" ? null : BigInt(value).toString())
    assert.equal(resolvedUi.element, "NonNegativeIntegerField")
    assert.deepEqual(resolvedUiInputNames(resolvedUi), ["counter"])
    assert.deepEqual(toInertValue(JSON.parse(JSON.stringify(resolvedUi))), toInertValue(resolvedUi))
  }
})

test("NonNegativeIntegerField resolves exact inclusive bounds from declared view values", () => {
  const maximum = (2n ** 256n - 1n).toString()
  const ui = parseUi({ ui: UI_VERSION, nodes: { counter: {
    requires: ["view"], element: "NonNegativeIntegerField",
    props: { label: "Counter", min: "$view.minimum", max: "$view.maximum" },
    state: { key: "counter", defaultValue: maximum },
  } } })
  const { state } = resolveInitialUiNode(ui, "counter", { view: { minimum: "9007199254740993", maximum } }, { ...context, state: {} })
  assert.equal(state.counter, maximum)
})

test("dedicated integer parsing does not reinterpret numeric-looking text identifiers", () => {
  const ui = parseUi({ ui: UI_VERSION, nodes: { app: { requires: [], element: "Screen", props: { title: "Identifiers" }, children: [
    { element: "NonNegativeIntegerField", props: { label: "Counter" }, state: { key: "counter", defaultValue: "00042" } },
    { element: "TextField", props: { label: "Identifier" }, state: { key: "identifier", defaultValue: "00042" } },
  ] } } })
  const { state } = resolveInitialUiNode(ui, "app", {}, { ...context, state: {} })
  assert.equal(state.counter, "42")
  assert.equal(state.identifier, "00042")
})

test("integer declarations reject malformed defaults and exact bounds before publishing a usable field", () => {
  const declaration = (defaultValue: unknown, props: Record<string, unknown>) => ({ ui: UI_VERSION, nodes: { counter: {
    requires: [], element: "NonNegativeIntegerField", props: { label: "Counter", ...props },
    state: { key: "counter", defaultValue },
  } } })
  for (const value of [null, 1, "-1", "+1", "1.0", "1e3", "1,000", " 1", "1\n2", "١", "1".repeat(1025), "0".repeat(2049)]) {
    assert.throws(() => resolveInitialUiNode(parseUi(declaration(value, {})), "counter", {}, { ...context, state: {} }), UiError)
  }
  for (const bound of [null, 1, "", "-1", "+1", "1.0", "1e3", " 1", "١", "1".repeat(1025), "0".repeat(2049)]) {
    for (const name of ["min", "max"]) {
      assert.throws(() => resolveInitialUiNode(parseUi(declaration("", { [name]: bound })), "counter", {}, { ...context, state: {} }), UiError)
    }
  }
  assert.throws(() => resolveInitialUiNode(parseUi(declaration("", { min: "9007199254740994", max: "9007199254740993" })), "counter", {}, { ...context, state: {} }), UiError)
  for (const value of ["0", "3"]) {
    assert.throws(() => resolveInitialUiNode(parseUi(declaration(value, { min: "1", max: "2" })), "counter", {}, { ...context, state: {} }), UiError)
  }
})

test("integer bounds are inclusive and compare values beyond machine number precision exactly", () => {
  for (const value of ["9007199254740993", "9007199254740994"]) {
    const ui = parseUi({ ui: UI_VERSION, nodes: { counter: {
      requires: [], element: "NonNegativeIntegerField", props: { label: "Counter", min: "9007199254740993", max: "9007199254740994" },
      state: { key: "counter", defaultValue: value },
    } } })
    assert.equal(resolveInitialUiNode(ui, "counter", {}, { ...context, state: {} }).state.counter, value)
  }
  const maximum = "1".repeat(1024)
  const ui = parseUi({ ui: UI_VERSION, nodes: { counter: {
    requires: [], element: "NonNegativeIntegerField", props: { label: "Counter", max: maximum },
    state: { key: "counter", defaultValue: "" },
  } } })
  const { state, resolvedUi } = resolveInitialUiNode(ui, "counter", {}, { ...context, state: {} })
  assert.ok(resolvedUi.element === "NonNegativeIntegerField")
  assert.equal(resolvedUi.props.max, maximum)
  assert.equal(state.counter, null)
})

test("integer bounds cannot depend on editable state directly or through Include arguments", () => {
  const counter = { requires: [], element: "NonNegativeIntegerField", props: { label: "Counter", max: "$state.ceiling" }, state: { key: "counter", defaultValue: "" } }
  const direct = parseUi({ ui: UI_VERSION, nodes: { counter } })
  assert.throws(() => resolveInitialUiNode(direct, "counter", {}, { ...context, state: { ceiling: "42" } }), UiError)
  const aliased = parseUi({ ui: UI_VERSION, nodes: {
    app: { requires: [], element: "Screen", props: { title: "Counter" }, children: [
      { element: "TextField", props: { label: "Ceiling" }, state: { key: "ceiling", defaultValue: "42" } },
      { element: "Include", call: { namespace: "ui", function: "counter", args: { view: { ceiling: "$state.ceiling" } } } },
    ] },
    counter: { ...counter, requires: ["view"], props: { label: "Counter", max: "$view.ceiling" } },
  } })
  assert.throws(() => resolveInitialUiNode(aliased, "app", {}, { ...context, state: {} }), UiError)
})

test("integer bindings reject duplicate ownership even when lexical defaults happen to match", () => {
  const integer = { element: "NonNegativeIntegerField", props: { label: "Counter" }, state: { key: "counter", defaultValue: "1" } }
  for (const second of [
    integer,
    { element: "TextField", props: { label: "Identifier" }, state: { key: "counter", defaultValue: "1" } },
    { element: "AmountField", props: { label: "Deposit", unit: { assetId: "declared", baseLabel: "base", displayLabel: "display", decimals: 0 } }, state: { key: "counter", defaultValue: "1" } },
  ]) {
    const ui = parseUi({ ui: UI_VERSION, nodes: { app: { requires: [], element: "Screen", props: { title: "Counter" }, children: [integer, second] } } })
    assert.throws(() => resolveInitialUiNode(ui, "app", {}, { ...context, state: {} }), UiError)
  }
})

test("AmountField declares one exact base amount with explicit paired unit presentation", () => {
  for (const { decimals, base, display } of [
    { decimals: 0, base: "9007199254740993", display: "9007199254740993" },
    { decimals: 6, base: "10001", display: "0.010001" },
    { decimals: 18, base: "10000000000000000", display: "0.01" },
    { decimals: 255, base: "1", display: `0.${"0".repeat(254)}1` },
    { decimals: 18, base: "0", display: "0" },
  ]) {
    const unit = { assetId: "eip155:31337/slip44:60", baseLabel: "base units", displayLabel: "Declared asset", decimals }
    const ui = parseUi({ ui: UI_VERSION, nodes: { amount: {
      requires: [], element: "AmountField", props: { label: "Deposit", unit }, state: { key: "amount", defaultValue: base },
    } } })
    const { state, resolvedUi } = resolveInitialUiNode(ui, "amount", {}, { ...context, state: {} })
    assert.equal(resolvedUi.element, "AmountField")
    if (resolvedUi.element !== "AmountField") assert.fail("expected the amount control")
    assert.deepEqual(toInertValue(resolvedUi.unit), toInertValue(unit))
    assert.equal(state.amount, base)
    assert.deepEqual(toInertValue(resolvedUi.draft), toInertValue({ representation: "base", baseText: base, displayText: display, status: "valid" }))
    assert.deepEqual(toInertValue(JSON.parse(JSON.stringify(resolvedUi))), toInertValue(resolvedUi))
    assert.deepEqual(resolvedUiInputNames(resolvedUi), ["amount"])
  }
})

test("empty AmountField default is unset, while zero stays an exact usable amount", () => {
  for (const value of ["", "0", "0000"]) {
    const ui = amountFieldUi(value)
    const { state, resolvedUi } = resolveInitialUiNode(ui, "amount", {}, { ...context, state: {} })
    if (resolvedUi.element !== "AmountField") assert.fail("expected the amount control")
    const draft = resolvedUi.draft
    assert.equal(state.amount, value === "" ? null : "0")
    assert.equal(draft.baseText, value)
    assert.equal(draft.displayText, value === "" ? "" : "0")
    assert.equal(draft.status, value === "" ? "empty" : "valid")
  }
})

test("AmountField accepts only explicit literal bounded unit metadata", () => {
  const valid = { assetId: "eip155:31337/slip44:60", baseLabel: "wei", displayLabel: "ETH", decimals: 18 }
  for (const unit of [
    { ...valid, decimals: -1 }, { ...valid, decimals: 256 }, { ...valid, decimals: 0.5 },
    { ...valid, decimals: "18" }, { ...valid, decimals: "$view.decimals" },
    { ...valid, assetId: "" }, { ...valid, baseLabel: "" }, { ...valid, displayLabel: "" },
    { ...valid, unexpected: true },
    { assetId: valid.assetId, baseLabel: valid.baseLabel, displayLabel: valid.displayLabel },
    "$view.unit", null,
  ]) {
    assert.throws(() => parseUi({ ui: UI_VERSION, nodes: { amount: {
      requires: [], element: "AmountField", props: { label: "Deposit", unit }, state: { key: "amount", defaultValue: "0" },
    } } }), (error: unknown) => error instanceof UiError, `unsupported unit ${JSON.stringify(unit)}`)
  }
})

test("AmountField rejects unknown properties and inherited required declarations", () => {
  const unit = { assetId: "eip155:31337/slip44:60", baseLabel: "wei", displayLabel: "ETH", decimals: 18 }
  for (const props of [
    { label: "Deposit", unit, unexpected: "must not be dropped" },
    Object.assign(Object.create({ label: "inherited label" }), { unit }),
    { label: "Deposit", unit: Object.create(unit) },
    { label: "Deposit", unit: Object.assign(Object.create({ decimals: 18 }), { assetId: unit.assetId, baseLabel: unit.baseLabel, displayLabel: unit.displayLabel }) },
  ]) {
    assert.throws(() => parseUi({ ui: UI_VERSION, nodes: { amount: {
      requires: [], element: "AmountField", props, state: { key: "amount", defaultValue: "0" },
    } } }), (error: unknown) => error instanceof UiError)
  }
})

test("declared amount unit strings stay literal even when they resemble expression syntax", () => {
  for (const unit of [
    { assetId: "$asset", baseLabel: "$", displayLabel: "$", decimals: 6 },
    { assetId: "$view.assetId", baseLabel: "$state.base", displayLabel: "$view.unit", decimals: 18 },
  ]) {
    const ui = parseUi({ ui: UI_VERSION, nodes: { amount: {
      requires: [], element: "AmountField", props: { label: "Deposit", unit }, state: { key: "amount", defaultValue: "1" },
    } } })
    const { resolvedUi } = resolveInitialUiNode(ui, "amount", {}, { ...context, state: {} })
    if (resolvedUi.element !== "AmountField") assert.fail("expected the amount control")
    assert.deepEqual(toInertValue(resolvedUi.unit), toInertValue(unit))
  }
})

for (const inheritedKey of ["label", "assetId", "decimals"] as const) {
  test(`AmountField requires its own ${inheritedKey} declaration even with inherited prototype values`, () => {
    const unit = { assetId: "eip155:31337/slip44:60", baseLabel: "wei", displayLabel: "ETH", decimals: 18 }
    const previous = Object.getOwnPropertyDescriptor(Object.prototype, inheritedKey)
    Object.defineProperty(Object.prototype, inheritedKey, { value: inheritedKey === "label" ? "inherited label" : unit[inheritedKey], configurable: true })
    try {
      const ownUnit = Object.fromEntries(Object.entries(unit).filter(([name]) => name !== inheritedKey))
      const props = inheritedKey === "label" ? { unit } : { label: "Deposit", unit: ownUnit }
      assert.throws(() => parseUi({ ui: UI_VERSION, nodes: { amount: {
        requires: [], element: "AmountField", props, state: { key: "amount", defaultValue: "0" },
      } } }), (error: unknown) => error instanceof UiError)
    } finally {
      if (previous === undefined) Reflect.deleteProperty(Object.prototype, inheritedKey)
      else Object.defineProperty(Object.prototype, inheritedKey, previous)
    }
  })
}

test("AmountField validates and retains one snapshot of a declared scale getter", () => {
  let reads = 0
  const unit = { assetId: "eip155:31337/slip44:60", baseLabel: "wei", displayLabel: "ETH", decimals: 18 }
  Object.defineProperty(unit, "decimals", { enumerable: true, get: () => {
    reads++
    return reads < 5 ? 18 : Number.MAX_SAFE_INTEGER
  } })
  const parsed = parseUi({ ui: UI_VERSION, nodes: { amount: {
    requires: [], element: "AmountField", props: { label: "Deposit", unit }, state: { key: "amount", defaultValue: "0" },
  } } })
  const node = parsed.nodes.amount
  assert.equal(node?.element, "AmountField")
  if (node?.element !== "AmountField") assert.fail("expected the declared amount control")
  assert.equal(node.unit.decimals, 18)
  assert.equal(reads, 1)
})

test("AmountField rejects malformed or oversized defaults instead of loading a misleading amount", () => {
  for (const value of [".", "0.", "-1", "1e3", " 1", "1 ", "1\n2", "1\r2", "1,000", null, 0, "1".repeat(1025), "0".repeat(2049)]) {
    assert.throws(() => resolveInitialUiNode(amountFieldUi(value), "amount", {}, { ...context, state: {} }),
      (error: unknown) => error instanceof UiError, `unsupported base default ${JSON.stringify(value)?.slice(0, 40)}`)
  }
})

test("AmountField participates in ordinary field identity and availability without inventing amount permissions", () => {
  const unit = { assetId: "eip155:31337/slip44:60", baseLabel: "wei", displayLabel: "ETH", decimals: 18 }
  const field = { element: "AmountField", props: { label: "Deposit", unit }, state: { key: "amount", defaultValue: "0" } }
  const ui = parseUi({ ui: UI_VERSION, nodes: { app: {
    requires: [], element: "Screen", props: { title: "Deposit" }, children: [{ ...field, enabledWhen: { member: "fund", in: [] } }],
  } } })
  const { state, resolvedUi } = resolveInitialUiNode(ui, "app", {}, { ...context, state: {} })
  let disabled: unknown
  forEachResolvedUiNode(resolvedUi, (node) => {
    if (node.element === "AmountField") disabled = node.disabled
  })
  assert.equal(disabled, true)
  assert.equal(state.amount, "0", "zero does not imply an unavailable business action")
  assert.deepEqual(resolvedUiInputNames(resolvedUi), ["amount"])
  assert.throws(() => resolveInitialUiNode(parseUi({ ui: UI_VERSION, nodes: { app: {
    requires: [], element: "Screen", props: { title: "Collision" }, children: [field,
      { element: "TextField", props: { label: "Other amount" }, state: { key: "amount", defaultValue: "1" } },
    ],
  } } }), "app", {}, { ...context, state: {} }), (error: unknown) => error instanceof UiError)
  assert.throws(() => resolveInitialUiNode(parseUi({ ui: UI_VERSION, nodes: { amount: {
    ...field, requires: [], state: { key: "__proto__", defaultValue: "0" },
  } } }), "amount", {}, { ...context, state: {} }), (error: unknown) => error instanceof UiError && /expression identifier/.test(error.message))
})

function amountFieldUi(defaultValue: unknown) {
  return parseUi({ ui: UI_VERSION, nodes: { amount: {
    requires: [], element: "AmountField", props: { label: "Deposit", unit: {
      assetId: "eip155:31337/slip44:60", baseLabel: "wei", displayLabel: "ETH", decimals: 18,
    } }, state: { key: "amount", defaultValue },
  } } })
}

test("declared Status formats preserve raw values while resolving exact readable text", () => {
  const cases = [
    { format: "bytes", value: "128", text: "128 bytes" },
    { format: "bytes", value: 1, text: "1 byte" },
    { format: "bytes", value: "9007199254740993", text: "9,007,199,254,740,993 bytes" },
    { format: "durationSeconds", value: "31536000", text: "365 days (31,536,000 seconds)" },
    { format: "durationSeconds", value: "90061", text: "1 day, 1 hour, 1 minute, 1 second (90,061 seconds)" },
    { format: "durationSeconds", value: "60", text: "1 minute (60 seconds)" },
    { format: "durationSeconds", value: "0", text: "0 seconds" },
    { format: "durationSeconds", value: "59", text: "59 seconds" },
    { format: "stringList", value: ["client", "contractor"], text: "client, contractor" },
    { format: "stringList", value: [], text: "None" },
  ]
  for (const { format, value, text } of cases) {
    const ui = parseUi({ ui: UI_VERSION, nodes: {
      app: { requires: ["view"], element: "Status", props: { label: "Value", value: "$view.value", format } },
    } })
    const args = { view: toInertValue({ value }) }
    const resolved = resolveUiNode(ui, "app", args, context)
    assert.equal(resolved.element, "Status")
    assert.equal("formattedValue" in resolved && resolved.formattedValue, text)
    assert.deepEqual(resolved.props.value, toInertValue(value))
    assert.deepEqual(toInertValue(JSON.parse(JSON.stringify(resolved))), toInertValue(resolved))
    assert.deepEqual(args.view, toInertValue({ value }))
  }
})

test("timestamp Status keeps UTC instants and exact seconds, including values beyond the calendar range", () => {
  for (const [value, text] of [
    ["0", "1970-01-01 00:00:00 UTC (0 Unix seconds)"],
    ["951782400", "2000-02-29 00:00:00 UTC (951,782,400 Unix seconds)"],
    ["8640000000000", "+275760-09-13 00:00:00 UTC (8,640,000,000,000 Unix seconds)"],
    ["8640000000001", "Outside UTC calendar range (8,640,000,000,001 Unix seconds)"],
    ["9007199254740993", "Outside UTC calendar range (9,007,199,254,740,993 Unix seconds)"],
  ]) {
    const ui = parseUi({ ui: UI_VERSION, nodes: {
      app: { requires: [], element: "Status", props: { label: "Deadline", value, format: "timestampSeconds" } },
    } })
    const resolved = resolveUiNode(ui, "app", {}, context)
    assert.ok(resolved.element === "Status")
    assert.equal(resolved.formattedValue, text)
    assert.equal(resolved.props.value, value)
  }
})

test("timestamp absence is explicit app meaning and applies only to zero", () => {
  const ui = parseUi({ ui: UI_VERSION, nodes: {
    app: { requires: ["view"], element: "Status", props: {
      label: "Deadline", value: "$view.value", format: "timestampSeconds", zeroText: "No active deadline",
    } },
  } })
  for (const value of ["0", "000", 0]) {
    const resolved = resolveUiNode(ui, "app", { view: toInertValue({ value }) }, context)
    assert.ok(resolved.element === "Status")
    assert.equal(resolved.formattedValue, "No active deadline")
  }
  const resolved = resolveUiNode(ui, "app", { view: { value: "1" } }, context)
  assert.ok(resolved.element === "Status")
  assert.equal(resolved.formattedValue, "1970-01-01 00:00:01 UTC (1 Unix seconds)")
  const dynamic = parseUi({ ui: UI_VERSION, nodes: {
    app: { requires: ["view"], element: "Status", props: {
      label: "Deadline", value: "0", format: "timestampSeconds", zeroText: "$view.text",
    } },
  } })
  for (const text of ["", "   ", 0, null]) {
    assert.throws(() => resolveUiNode(dynamic, "app", { view: toInertValue({ text }) }, context),
      (error: unknown) => error instanceof UiError && error.path === "app.props.zeroText")
  }
  for (const props of [
    { format: "timestampSeconds", zeroText: "" },
    { format: "timestampSeconds", zeroText: 0 },
    { format: "durationSeconds", zeroText: "None" },
    { zeroText: "None" },
  ]) {
    assert.throws(() => parseUi({ ui: UI_VERSION, nodes: {
      app: { requires: [], element: "Status", props: { label: "Deadline", value: "0", ...props } },
    } }), (error: unknown) => error instanceof UiError && error.path === "nodes.app.props.zeroText")
  }
})

test("Status without a format keeps inert values raw and invents no presentation semantics", () => {
  for (const value of ["31536000", "0x1234", ["client", "contractor"], { seconds: "60" }]) {
    const ui = parseUi({ ui: UI_VERSION, nodes: {
      app: { requires: [], element: "Status", props: { label: "Unformatted", value } },
    } })
    const resolved = resolveUiNode(ui, "app", {}, context)
    assert.ok(resolved.element === "Status")
    assert.equal(Object.hasOwn(resolved, "formattedValue"), false)
    assert.deepEqual(resolved.props.value, toInertValue(value))
  }
})

test("duration presentation accounts for every second beyond floating-point integer precision", () => {
  const value = "9007199254740993"
  const ui = parseUi({ ui: UI_VERSION, nodes: {
    app: { requires: [], element: "Status", props: { label: "Duration", value, format: "durationSeconds" } },
  } })
  const resolved = resolveUiNode(ui, "app", {}, context)
  assert.ok("formattedValue" in resolved && typeof resolved.formattedValue === "string")
  const text = resolved.formattedValue
  assert.ok(text.endsWith("(9,007,199,254,740,993 seconds)"))
  const secondsPerUnit: Record<string, bigint> = { day: 86400n, hour: 3600n, minute: 60n, second: 1n }
  const total = [...text.split(" (")[0].matchAll(/([\d,]+) (day|hour|minute|second)s?/g)]
    .reduce((sum, match) => sum + BigInt(match[1].replaceAll(",", "")) * secondsPerUnit[match[2]], 0n)
  assert.equal(total, BigInt(value))
})

test("declared integer presentation retains every digit of long values", () => {
  const value = `1${"0".repeat(3000)}`
  const ui = parseUi({ ui: UI_VERSION, nodes: {
    app: { requires: [], element: "Status", props: { label: "Size", value, format: "bytes" } },
  } })
  const resolved = resolveUiNode(ui, "app", {}, context)
  assert.ok("formattedValue" in resolved && typeof resolved.formattedValue === "string")
  const groups = resolved.formattedValue.replace(/ bytes$/, "").split(",")
  assert.equal(groups.join(""), value)
  assert.equal(groups.length, 1001)
  assert.ok(groups.slice(1).every((group) => group.length === 3))
  assert.equal(resolved.props.value, value)
})

test("Status format declarations are literal supported presentation choices", () => {
  for (const format of ["unknown", "$view.format", "", true, null, ["bytes"]]) {
    assert.throws(() => parseUi({ ui: UI_VERSION, nodes: {
      app: { requires: [], element: "Status", props: { label: "Value", value: "1", format } },
    } }), (error: unknown) => error instanceof UiError
      && error.code === "UI_INVALID_FIELD" && error.path === "nodes.app.props.format")
  }
})

test("formatted Status operands fail during resolution rather than after a view is published", () => {
  for (const format of ["bytes", "durationSeconds", "timestampSeconds"]) {
    const ui = parseUi({ ui: UI_VERSION, nodes: {
      app: { requires: ["view"], element: "Status", props: { label: "Value", value: "$view.value", format } },
    } })
    for (const value of ["-1", "1.5", "1e3", "0x10", "", -1, 0.5, Number.MAX_SAFE_INTEGER + 1, true, null, {}]) {
      assert.throws(() => resolveUiNode(ui, "app", { view: toInertValue({ value }) }, context),
        (error: unknown) => error instanceof UiError && error.code === "UI_INVALID_FIELD"
          && error.path === "app.props.value" && /non-negative.*integer/.test(error.message))
    }
  }
  const ui = parseUi({ ui: UI_VERSION, nodes: {
    app: { requires: ["view"], element: "Status", props: { label: "Choices", value: "$view.value", format: "stringList" } },
  } })
  for (const value of ["client", ["client", 2], [null], {}]) {
    assert.throws(() => resolveUiNode(ui, "app", { view: toInertValue({ value }) }, context),
      (error: unknown) => error instanceof UiError && error.code === "UI_INVALID_FIELD"
        && error.path === "app.props.value" && /array of strings/.test(error.message))
  }
})

test("walks resolved UI trees in render order", () => {
  const visited: string[] = []

  forEachResolvedUiNode({
    element: "Screen",
    props: {},
    children: [
      {
        element: "TextField",
        props: {},
        state: { key: "serialNumber" },
        children: [] as const,
      },
      {
        element: "Button",
        props: {},
        call: {
          namespace: "routes",
          function: "lookupComponent",
          args: {},
        },
      },
    ],
  }, (node) => {
    visited.push(node.element)
  })

  assert.deepEqual(visited, ["Screen", "TextField", "Button"])
})

test("queries resolved UI buttons and input names deterministically", () => {
  const firstButton = {
    element: "Button" as const,
    props: {},
    call: {
      namespace: "routes",
      function: "lookupComponent",
      args: {},
    },
  }
  const secondButton = {
    element: "Button" as const,
    props: {},
    call: {
      namespace: "routes",
      function: "retireComponent",
      args: {},
    },
  }
  const resolved = {
    element: "Screen" as const,
    props: {},
    children: [
      {
        element: "TextField" as const,
        props: {},
        state: { key: "serialNumber" },
        children: [] as const,
      },
      {
        element: "Fragment" as const,
        props: {},
        children: [
          {
            element: "TextField" as const,
            props: {},
            state: { key: "owner" },
            children: [] as const,
          },
          {
            element: "TextField" as const,
            props: {},
            state: { key: "serialNumber" },
            children: [] as const,
          },
          firstButton,
        ],
      },
      secondButton,
    ],
  }

  assert.deepEqual(resolvedUiButtons(resolved), [firstButton, secondButton])
  assert.deepEqual(resolvedUiInputNames(resolved), ["owner", "serialNumber"])
})

test("resolves a UI catalog through Include nodes into render and action nodes", () => {
  const ui = parseUi({
    ui: UI_VERSION,
    nodes: {
      app: {
        element: "Screen",
        requires: ["view"],
        props: {
          title: "Bicycle component registry",
        },
        children: [
          {
            element: "Include",
            call: {
              namespace: "ui",
              function: "$view.viewId",
              args: {
                view: "$view",
              },
            },
          },
          {
            element: "Include",
            call: {
              namespace: "ui",
              function: "$view.actions",
              args: {},
            },
          },
        ],
      },
      entry: {
        element: "Fragment",
        requires: ["view"],
        children: [
          {
            element: "TextField",
            props: {
              label: "Serial number",
            },
            state: {
              key: "serialNumber",
              defaultValue: "$view.serialNumber",
            },
          },
        ],
      },
      lookupComponent: {
        element: "Button",
        requires: [],
        props: {
          label: "Look up component",
        },
        call: {
          namespace: "routes",
          function: "component",
          args: {
            serialNumber: "$state.serialNumber",
          },
        },
      },
    },
  })

  const resolved = resolveUiNode(ui, "app", inertRecord({
    view: {
      viewId: "entry",
      actions: ["lookupComponent"],
      serialNumber: "",
    },
  }), context)

  assert.equal(resolved.element, "Screen")
  assert.equal(resolved.props.title, "Bicycle component registry")
  assert.equal(resolved.children.length, 2)

  const [view, action] = resolved.children
  assert.equal(view?.element, "Fragment")
  if (view?.element !== "Fragment") throw new Error("expected Fragment view")
  const firstChild = view.children[0]
  assert.equal(firstChild?.element, "TextField")
  if (firstChild?.element !== "TextField") throw new Error("expected TextField child")
  assert.equal(firstChild.state.key, "serialNumber")

  assert.equal(action?.element, "Button")
  assert.equal(action?.props.label, "Look up component")
  assert.equal(action?.call.namespace, "routes")
  assert.equal(action?.call.function, "component")
  assert.equal(action?.call.args.serialNumber, "ABC123")
})

test("resolveInitialUiNode skips action Include args until state exists", () => {
  const ui = parseUi({
    ui: UI_VERSION,
    nodes: {
      app: {
        element: "Screen",
        requires: [],
        props: {
          title: "Stateful action",
        },
        children: [
          {
            element: "TextField",
            props: {
              label: "Serial number",
            },
            state: {
              key: "serialNumber",
              defaultValue: "ABC123",
            },
          },
          {
            element: "Include",
            call: {
              namespace: "ui",
              function: "lookupComponent",
              args: {
                view: {
                  serialNumber: "$state.serialNumber",
                },
              },
            },
          },
        ],
      },
      lookupComponent: {
        element: "Button",
        requires: ["view"],
        props: {
          label: "Look up component",
        },
        call: {
          namespace: "routes",
          function: "component",
          args: {
            serialNumber: "$view.serialNumber",
          },
        },
      },
    },
  })

  const { state, resolvedUi } = resolveInitialUiNode(ui, "app", inertRecord({}), context)
  assert.equal(resolvedUi.element, "Screen")
  if (resolvedUi.element !== "Screen") {
    throw new Error("expected Screen")
  }
  const action = resolvedUi.children.find((child) => child.element === "Button")

  assert.equal(state.serialNumber, "ABC123")
  assert.equal(action?.element, "Button")
  assert.equal(action?.call.args.serialNumber, "ABC123")
})

test("resolveInitialUiNode collects state before resolving state-backed render props", () => {
  const ui = parseUi({
    ui: UI_VERSION,
    nodes: {
      app: {
        element: "Screen",
        requires: [],
        props: {
          title: "Stateful render",
        },
        children: [
          {
            element: "TextField",
            props: {
              label: "Serial number",
            },
            state: {
              key: "serialNumber",
              defaultValue: "ABC123",
            },
          },
          {
            element: "Include",
            call: {
              namespace: "ui",
              function: "actions",
              args: {
                view: {
                  serialNumber: "$state.serialNumber",
                },
              },
            },
          },
          {
            element: "Text",
            props: {
              text: "$state.serialNumber",
            },
          },
        ],
      },
      actions: {
        element: "Fragment",
        requires: ["view"],
        children: [
          {
            element: "Button",
            props: {
              label: "Look up component",
            },
            call: {
              namespace: "routes",
              function: "component",
              args: {
                serialNumber: "$view.serialNumber",
              },
            },
          },
        ],
      },
    },
  })

  const { state, resolvedUi } = resolveInitialUiNode(ui, "app", inertRecord({}), context)
  assert.equal(state.serialNumber, "ABC123")
  assert.equal(resolvedUi.element, "Screen")
  if (resolvedUi.element !== "Screen") {
    throw new Error("expected Screen")
  }
  const action = resolvedUiButtons(resolvedUi)[0]
  const text = resolvedUi.children.find((child) => child.element === "Text")

  assert.equal(action?.element, "Button")
  assert.equal(action?.call.args.serialNumber, "ABC123")
  assert.equal(text?.element, "Text")
  assert.equal(text?.props.text, "ABC123")
})

test("resolveUiNode rejects args that shadow runtime roots", () => {
  const ui = parseUi({
    ui: UI_VERSION,
    nodes: {
      app: {
        element: "Text",
        requires: [],
        props: {
          text: "shadow",
        },
      },
    },
  })

  assert.throws(
    () => resolveUiNode(ui, "app", inertRecord({ state: {} }), context),
    /must not shadow runtime root: state/,
  )
})

test("resolveUiNode reports unresolved account as structured error details", () => {
  const ui = parseUi({
    ui: UI_VERSION,
    nodes: {
      app: {
        element: "Button",
        requires: [],
        props: {
          label: "Use account",
        },
        call: {
          namespace: "routes",
          function: "entry",
          args: {
            account: "$account.address",
          },
        },
      },
    },
  })
  const anonymousContext = {
    host: context.host,
    inputs: context.inputs,
    outputs: context.outputs,
    state: context.state,
  }

  assert.throws(
    () => resolveUiNode(ui, "app", inertRecord({}), anonymousContext),
    (error) => error instanceof UiError
      && error.code === "UI_UNRESOLVED_VALUE"
      && error.unresolvedRoot === "account",
  )
})

test("resolveInitialUiNode rejects TextField state keys that cannot be referenced from state", () => {
  const ui = parseUi({
    ui: UI_VERSION,
    nodes: {
      app: {
        element: "Screen",
        requires: [],
        props: {
          title: "Invalid input",
        },
        children: [
          {
            element: "TextField",
            props: {
              label: "Serial number",
            },
            state: {
              key: "serial-number",
              defaultValue: "",
            },
          },
        ],
      },
    },
  })

  assert.throws(
    () => resolveInitialUiNode(ui, "app", inertRecord({}), context),
    /TextField state.key must resolve to an expression identifier: serial-number/,
  )
})

test("resolveUiNode rejects include cycles and undeclared node args", () => {
  const cyclic = parseUi({
    ui: UI_VERSION,
    nodes: {
      app: {
        element: "Include",
        requires: [],
        call: {
          namespace: "ui",
          function: "app",
          args: {},
        },
      },
    },
  })

  assert.throws(
    () => resolveUiNode(cyclic, "app", inertRecord({}), context),
    /UI Include cycle detected: app -> app/,
  )

  const strictArgs = parseUi({
    ui: UI_VERSION,
    nodes: {
      app: {
        element: "Text",
        requires: [],
        props: {
          text: "strict",
        },
      },
    },
  })

  assert.throws(
    () => resolveUiNode(strictArgs, "app", inertRecord({ extra: "x" }), context),
    /not declared in requires: extra/,
  )
})

test("resolveUiNode rejects duplicate or empty Include selections", () => {
  const ui = parseUi({
    ui: UI_VERSION,
    nodes: {
      app: {
        element: "Include",
        requires: ["view"],
        call: {
          namespace: "ui",
          function: "$view.nodes",
          args: {},
        },
      },
      item: {
        element: "Text",
        requires: [],
        props: {
          text: "Item",
        },
      },
    },
  })

  assert.throws(
    () => resolveUiNode(ui, "app", inertRecord({ view: { nodes: ["item", "item"] } }), context),
    /must not duplicate node names: item/,
  )
  assert.throws(
    () => resolveUiNode(ui, "app", inertRecord({ view: { nodes: "" } }), context),
    /must not contain an empty node name/,
  )
})

test("parseUi rejects required arguments outside the UI node interface", () => {
  assert.throws(
    () => parseUi({
      ui: UI_VERSION,
      nodes: {
        app: {
          element: "Text",
          requires: ["foo"],
          props: {
            text: "unsupported argument",
          },
        },
      },
    }),
    /unsupported required argument: foo/,
  )
})

test("parseUi rejects stale screen-era and control fields", () => {
  assert.throws(
    () => parseUi({
      screen: "1.0.0",
      title: "Old screen",
      elements: [],
    }),
    /ui/,
  )

  assert.throws(
    () => parseUi({
      ui: UI_VERSION,
      title: "Metadata-like top-level fields are not UI nodes",
      nodes: {
        entry: {
          element: "Text",
          requires: [],
          props: {
            text: "Registered",
          },
        },
      },
    }),
    /title/,
  )

  assert.throws(
    () => parseUi({
      ui: UI_VERSION,
      nodes: {
        entry: {
          element: "Text",
          requires: [],
          props: {
            text: "Registered",
          },
          visibleWhen: "$view.exists",
        },
      },
    }),
    /visibleWhen/,
  )
})

test("parseUi rejects calls wired to the wrong namespace", () => {
  assert.throws(
    () => parseUi({
      ui: UI_VERSION,
      nodes: {
        include: {
          element: "Include",
          requires: [],
          call: {
            namespace: "routes",
            function: "entry",
            args: {},
          },
        },
      },
    }),
    /ui namespace/,
  )

  assert.throws(
    () => parseUi({
      ui: UI_VERSION,
      nodes: {
        action: {
          element: "Button",
          requires: [],
          props: {
            label: "Bad action",
          },
          call: {
            namespace: "ui",
            function: "entry",
            args: {},
          },
        },
      },
    }),
    /routes namespace/,
  )
})

test("parseUi rejects statically invalid call function shapes", () => {
  assert.throws(
    () => parseUi({
      ui: UI_VERSION,
      nodes: {
        action: {
          element: "Button",
          requires: [],
          props: {
            label: "Bad action",
          },
          call: {
            namespace: "routes",
            function: ["entry"],
            args: {},
          },
        },
      },
    }),
    /Button function must be a string/,
  )

  assert.throws(
    () => parseUi({
      ui: UI_VERSION,
      nodes: {
        include: {
          element: "Include",
          requires: [],
          call: {
            namespace: "ui",
            function: ["entry", false],
            args: {},
          },
        },
      },
    }),
    /Include function array items must be strings/,
  )
})

test("parseUi and resolveUiNode reject invalid element props", () => {
  assert.throws(
    () => parseUi({
      ui: UI_VERSION,
      nodes: {
        text: {
          element: "Text",
          requires: [],
          props: {
            label: "not a text prop",
          },
        },
      },
    }),
    /text/,
  )

  assert.throws(
    () => parseUi({
      ui: UI_VERSION,
      nodes: {
        action: {
          element: "Button",
          requires: [],
          props: {
            label: false,
          },
          call: {
            namespace: "routes",
            function: "component",
            args: {},
          },
        },
      },
    }),
    /label/,
  )

  const ui = parseUi({
    ui: UI_VERSION,
    nodes: {
      action: {
        element: "Button",
        requires: ["view"],
        props: {
          label: "$view.label",
        },
        call: {
          namespace: "routes",
          function: "component",
          args: {},
        },
      },
    },
  })

  assert.throws(
    () => resolveUiNode(ui, "action", inertRecord({
      view: {
        label: false,
      },
    }), context),
    /label/,
  )

  const addressUi = parseUi({
    ui: UI_VERSION,
    nodes: {
      owner: {
        element: "Address",
        requires: ["view"],
        props: {
          label: "Owner",
          address: "$view.owner",
        },
      },
    },
  })

  assert.throws(
    () => resolveUiNode(addressUi, "owner", inertRecord({
      view: {
        owner: "not-an-address",
      },
    }), context),
    /must resolve to an address: address/,
  )
})

test("resolveUiNode fails closed on missing required arguments and non-string action functions", () => {
  const ui = parseUi({
    ui: UI_VERSION,
    nodes: {
      action: {
        element: "Button",
        requires: ["view"],
        props: {
          label: "Broken",
        },
        call: {
          namespace: "routes",
          function: "$view.actions",
          args: {},
        },
      },
    },
  })

  assert.throws(
    () => resolveUiNode(ui, "action", inertRecord({}), context),
    /view/,
  )

  assert.throws(
    () => resolveUiNode(ui, "action", inertRecord({
      view: {
        actions: ["component"],
      },
    }), context),
    /call function must resolve to a string/,
  )

  assert.throws(
    () => resolveUiNode(ui, "action", inertRecord({
      view: {
        actions: "",
      },
    }), context),
    /call function must resolve to a non-empty string/,
  )
})

function inertRecord(value: unknown): InertRecord {
  return toInertValue(value) as InertRecord
}
