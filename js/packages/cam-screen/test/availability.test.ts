import assert from "node:assert/strict"
import test from "node:test"
import { UI_VERSION } from "@cam/protocol"

import {
  parseUi,
  resolvedUiButtons,
  resolvedUiInputNames,
  resolveInitialUiNode,
  resolveUiNode,
  UiError,
} from "../src/index.ts"
import type { ResolvedUiNode } from "../src/index.ts"

const context = {
  host: { chainId: "eip155:31337", address: "0x0000000000000000000000000000000000000001" },
  account: { address: "0x0000000000000000000000000000000000000002" },
  inputs: {},
  outputs: [],
  state: {},
}

function documentWithAvailability(enabledWhen: unknown) {
  return {
    ui: UI_VERSION,
    nodes: {
      app: {
        requires: ["view"],
        element: "Fragment",
        children: [
          {
            element: "TextField",
            props: { label: "Evidence" },
            state: { key: "evidence", defaultValue: "initial evidence" },
            enabledWhen,
          },
          {
            element: "Button",
            props: { label: "Publish evidence" },
            call: { namespace: "routes", function: "publish", args: { id: "$view.id", evidence: "$state.evidence" } },
            enabledWhen,
          },
          { element: "Button", props: { label: "Inspect" }, call: { namespace: "routes", function: "inspect", args: {} } },
        ],
      },
    },
  }
}

function controlDisabled(node: ResolvedUiNode): boolean | undefined {
  return "disabled" in node ? node.disabled === true : undefined
}

test("membership controls remain visible with defaults and exact calls, regardless of availability", () => {
  const ui = parseUi(documentWithAvailability({ member: "publish", in: "$view.actions" }))
  for (const actions of [[], ["inspect"], ["publish"], ["inspect", "publish"]]) {
    const initial = resolveInitialUiNode(ui, "app", { view: { id: "instance-9007199254740993", actions } }, context)
    assert.equal(initial.resolvedUi.element, "Fragment")
    if (initial.resolvedUi.element !== "Fragment") throw new Error("expected Fragment")
    assert.equal(initial.resolvedUi.children.length, 3)
    assert.deepEqual(resolvedUiInputNames(initial.resolvedUi), ["evidence"])
    assert.deepEqual({ ...initial.state }, { evidence: "initial evidence" })
    const expectedDisabled = !actions.includes("publish")
    assert.equal(controlDisabled(initial.resolvedUi.children[0]!), expectedDisabled)
    const buttons = resolvedUiButtons(initial.resolvedUi)
    assert.equal(buttons.length, 2)
    assert.equal(controlDisabled(buttons[0]!), expectedDisabled)
    assert.deepEqual({ ...buttons[0]?.call.args }, { id: "instance-9007199254740993", evidence: "initial evidence" })
    assert.notEqual(controlDisabled(buttons[1]!), true, "ungated controls remain enabled")
  }
})

test("availability changes preserve supplied draft values and use literal member equality", () => {
  const ui = parseUi(documentWithAvailability({ member: "publish", in: "$view.actions" }))
  const state = { evidence: "unsent draft" }
  for (const actions of [["publish"], [], ["publish-more"], ["publish"]]) {
    const resolved = resolveUiNode(ui, "app", { view: { id: "same-instance", actions } }, { ...context, state })
    const action = resolvedUiButtons(resolved)[0]!
    assert.equal(controlDisabled(action), !actions.includes("publish"))
    assert.deepEqual({ ...action.call.args }, { id: "same-instance", evidence: "unsent draft" })
    assert.deepEqual(state, { evidence: "unsent draft" })
  }
})

test("literal membership lists use the same semantics as projected lists", () => {
  for (const members of [[], ["publish"], ["unrelated", "publish"]]) {
    const ui = parseUi(documentWithAvailability({ member: "publish", in: members }))
    const initial = resolveInitialUiNode(ui, "app", { view: { id: "instance" } }, context)
    assert.equal(controlDisabled(resolvedUiButtons(initial.resolvedUi)[0]!), !members.includes("publish"))
  }
})

test("membership declarations reject malformed shapes instead of coercing them", () => {
  for (const declaration of [
    null, true, {}, { member: "publish" }, { in: [] },
    { member: "", in: [] }, { member: 1, in: [] }, { member: "$view.action", in: [] },
    { member: "publish", in: "publish" }, { member: "publish", in: 1 },
    { member: "publish", in: [1] }, { member: "publish", in: [""] },
    { member: "publish", in: ["$view.action"] }, { member: "publish", in: [], extra: true },
    { member: "publish", in: "$view.actions.includes('publish')" },
    { member: "publish", in: "$wallet.actions" },
  ]) {
    assert.throws(() => parseUi(documentWithAvailability(declaration)), UiError)
  }
})

test("membership resolution rejects missing and wrongly typed lists at the availability boundary", () => {
  const ui = parseUi(documentWithAvailability({ member: "publish", in: "$view.actions" }))
  for (const actions of [null, true, "publish", 1, {}, [1], [""]]) {
    assert.throws(
      () => resolveInitialUiNode(ui, "app", { view: { id: "instance", actions } }, context),
      (error: unknown) => error instanceof UiError && error.path === "app.children.0.enabledWhen.in",
    )
  }
  assert.throws(
    () => resolveInitialUiNode(ui, "app", { view: { id: "instance" } }, context),
    (error: unknown) => error instanceof UiError && error.path === "app.children.0.enabledWhen.in",
  )
})

test("availability is a control declaration, not an arbitrary prop or content condition", () => {
  assert.throws(() => parseUi({
    ui: UI_VERSION,
    nodes: { app: { requires: [], element: "Text", props: { text: "Text" }, enabledWhen: { member: "publish", in: [] } } },
  }), UiError)
  assert.throws(() => parseUi({
    ui: UI_VERSION,
    nodes: { app: { requires: [], element: "Button", props: { label: "Publish", enabledWhen: { member: "publish", in: [] } }, call: { namespace: "routes", function: "publish", args: {} } } },
  }), UiError)
})
