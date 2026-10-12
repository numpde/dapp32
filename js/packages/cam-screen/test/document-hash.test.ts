import assert from "node:assert/strict"
import test from "node:test"
import { UI_VERSION } from "@cam/protocol"
import { parseUi, resolveInitialUiNode, resolveUiNode, resolvedUiInputNames } from "../src/index.ts"

const context = { host: { chainId: "eip155:31337", address: "0x0000000000000000000000000000000000000001" }, inputs: {}, outputs: [], state: {} }
function document(props: unknown) {
  return { ui: UI_VERSION, nodes: { app: { requires: [], element: "Fragment", children: [
    { element: "TextField", props: { label: "URI" }, state: { key: "uri", defaultValue: "https://example.test/terms" } },
    { element: "DocumentHashField", props, state: { key: "digest", defaultValue: "manual" }, enabledWhen: { member: "submit", in: [] } },
  ] } } }
}

test("DocumentHashField resolves scalar state, source expression and visible disabled availability", () => {
  const ui = parseUi(document({ label: "Digest", algorithm: "sha256", sourceURI: "$state.uri" }))
  const initial = resolveInitialUiNode(ui, "app", {}, context)
  assert.deepEqual({ ...initial.state }, { uri: "https://example.test/terms", digest: "manual" })
  assert.deepEqual(resolvedUiInputNames(initial.resolvedUi), ["digest", "uri"])
  assert.equal(initial.resolvedUi.element, "Fragment")
  if (initial.resolvedUi.element !== "Fragment") throw new Error("Expected Fragment")
  const node = initial.resolvedUi.children[1]
  assert.equal(String(node?.element), "DocumentHashField")
  assert.equal(node && "disabled" in node && node.disabled, true)
  assert.deepEqual(node?.props, { label: "Digest", algorithm: "sha256", sourceURI: "https://example.test/terms" })
  const edited = resolveUiNode(ui, "app", {}, { ...context, state: { uri: "https://example.test/moved", digest: "manual" } })
  if (edited.element !== "Fragment") throw new Error("Expected Fragment")
  assert.deepEqual(edited.children[1] && "props" in edited.children[1] ? edited.children[1].props : undefined, { label: "Digest", algorithm: "sha256", sourceURI: "https://example.test/moved" })
})

test("DocumentHashField supports manual-only scalar state", () => {
  const ui = parseUi(document({ label: "Digest", algorithm: "sha256" }))
  const result = resolveInitialUiNode(ui, "app", {}, context)
  if (result.resolvedUi.element !== "Fragment") throw new Error("Expected Fragment")
  assert.deepEqual(result.resolvedUi.children[1] && "props" in result.resolvedUi.children[1] ? result.resolvedUi.children[1].props : undefined, { label: "Digest", algorithm: "sha256" })
})

test("DocumentHashField rejects missing, dynamic and unsupported algorithms and malformed sourceURI", () => {
  for (const props of [{ label: "Digest" }, { label: "Digest", algorithm: "keccak256" }, { label: "Digest", algorithm: "$state.algorithm" }, { label: "Digest", algorithm: "sha256", sourceURI: 3 }]) {
    assert.throws(() => parseUi(document(props)))
  }
  const ui = parseUi(document({ label: "Digest", algorithm: "sha256", sourceURI: "$state.uri" }))
  assert.throws(() => resolveUiNode(ui, "app", {}, { ...context, state: { uri: 3, digest: "manual" } }))
})

test("DocumentHashField shares the unique rendered scalar state key law", () => {
  for (const element of ["TextField", "DocumentHashField"]) {
    const input = document({ label: "Digest", algorithm: "sha256", sourceURI: "$state.uri" })
    input.nodes.app.children[0] = { element, props: element === "TextField" ? { label: "URI" } : { label: "Digest", algorithm: "sha256" }, state: { key: "digest", defaultValue: "manual" } } as typeof input.nodes.app.children[0]
    assert.throws(() => resolveInitialUiNode(parseUi(input), "app", {}, context), /duplicate .*state key/)
  }
})
