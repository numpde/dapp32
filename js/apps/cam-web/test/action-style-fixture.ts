import { createElement } from "react"
import { createRoot } from "react-dom/client"
import type { ResolvedButtonNode } from "@cam/screen"
import type { CamViewerLoadedSnapshot, CamViewerPreparedContractCall } from "@cam/viewer"
import { PreparedCallView, UiView } from "../src/components.tsx"
import "../src/styles.css"

const element = document.getElementById("root")
if (element === null) throw new Error("Action fixture root is missing")
const root = createRoot(element)
const actions = [
  { route: "read", kind: "navigate", label: "Send immediately" },
  { route: "write", kind: "contractCall", label: "Open details" },
  { route: "missing", kind: "unsupported", label: "Unknown destination" },
  { route: "disabledRead", kind: "navigate", label: "Unavailable view", disabled: true },
  { route: "disabledWrite", kind: "contractCall", label: "Unavailable review", disabled: true },
  { route: "longRead", kind: "navigate", label: "Open a deliberately long view description that must wrap at a narrow viewport without moving adjacent values outside their shared columns" },
] as const
const call: CamViewerPreparedContractCall = { route: "write", address: "0x0000000000000000000000000000000000000001", abi: [], function: "fixtureWrite", args: {}, then: { namespace: "routes", function: "read", args: {} } }
let prepared = false
let busy = false
let sending = false
let draft = "unchanged"
const events = { navigate: 0, contractCall: 0, unsupported: 0, send: 0 }
function actionKind(action: ResolvedButtonNode): "navigate" | "contractCall" | "unsupported" {
  const declared = actions.find(item => item.route === action.call.function)
  if (declared === undefined) throw new Error("Fixture action was not declared")
  return declared.kind
}
function render(): void {
  const snapshot: CamViewerLoadedSnapshot = { canGoBack: false, route: "fixture", inputs: {}, state: { draft }, values: [], uiURI: "fixture", documentHashes: {}, resolvedUi: { element: "Fragment", props: {}, children: [
    { element: "Status", props: { label: "Before actions", value: "Before" }, children: [] },
    { element: "TextField", props: { label: "Draft" }, state: { key: "draft" }, children: [] },
    ...actions.map(item => ({ element: "Button" as const, props: { label: item.label }, call: { namespace: "routes", function: item.route, args: {} }, children: [] as const, ...("disabled" in item ? { disabled: item.disabled } : {}) })),
    { element: "Status", props: { label: "After actions", value: "After" }, children: [] },
  ] } }
  const props = { snapshot, viewRef: null, changingView: busy, sending, actionKind,
    onBack: async () => {}, onRefresh: async () => {},
    onAction: async (action: ResolvedButtonNode) => { const kind = actionKind(action); events[kind]++; if (kind === "contractCall") prepared = true; render() },
    onInput: (_name: string, value: string) => { draft = value; render() }, onAmount: () => {}, onInteger: () => {}, onDuration: () => {}, onDocumentHash: async () => {}, onCancelDocumentHash: () => {},
  }
  root.render(createElement("div", null,
    createElement(UiView, props),
    prepared ? createElement(PreparedCallView, { call, reviewRef: null, canSend: true, canDiscard: true, sending, onSend: async () => { events.send++ }, onDiscard: () => { prepared = false; render() } }) : null,
  ))
}
Object.assign(window, { actionFixture: { events, busy(value: boolean) { busy = value; render() }, sending(value: boolean) { sending = value; render() }, draft() { return draft } } })
render()
