import { createElement } from "react"
import { createRoot } from "react-dom/client"
import type { ResolvedButtonNode } from "@cam/screen"
import type { CamViewerLoadedSnapshot, CamViewerPreparedContractCall } from "@cam/viewer"
import { ConnectionSummary, PreparedCallView, UiView } from "../src/components.tsx"
import { TransactionFeedback } from "../src/feedback.tsx"
import type { SubmittedTransactionReference } from "../src/transactions.ts"
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
let hashPhase: "idle" | "pending" | "succeeded" = "pending"
let transactionReport: { transaction: SubmittedTransactionReference | undefined } | undefined
const events = { navigate: 0, contractCall: 0, unsupported: 0, send: 0, wallet: 0, calculate: 0, cancel: 0, back: 0, refresh: 0 }
function fixtureActionKind(action: ResolvedButtonNode): "navigate" | "contractCall" | "unsupported" {
  const declared = actions.find(item => item.route === action.call.function)
  if (declared === undefined) throw new Error("Fixture action was not declared")
  return declared.kind
}
function render(): void {
  const snapshot: CamViewerLoadedSnapshot = { visitId: 1, integrityWarnings: [], canGoBack: true, route: "fixture", inputs: {}, state: { draft, document: "" }, values: [], uiURI: "fixture", documentHashes: hashPhase === "idle" ? {} : { document: { status: hashPhase, source: "url" } }, resolvedUi: { element: "Fragment", props: {}, children: [
    { element: "Status", props: { label: "Before actions", value: "Before" }, children: [] },
    { element: "Screen", props: { title: "Fixture actions" }, children: [
      { element: "TextField", props: { label: "Draft" }, state: { key: "draft" }, children: [] },
      ...actions.map(item => ({ element: "Button" as const, props: { label: item.label }, call: { namespace: "routes", function: item.route, args: {} }, children: [] as const, ...("disabled" in item ? { disabled: item.disabled } : {}) })),
    ] },
    { element: "DocumentHashField", props: { label: "Document", algorithm: "sha256", sourceURI: "https://example.test/document" }, state: { key: "document" }, children: [] },
    { element: "Status", props: { label: "Timestamp", value: "100", format: "timestampSeconds" }, formattedValue: "1970-01-01 00:01:40 UTC (100 Unix seconds)", children: [] },
    { element: "Status", props: { label: "After actions", value: "After" }, children: [] },
  ] } }
  const props = { snapshot, canReviewTransaction: true, actionKind: fixtureActionKind, viewRef: null, changingView: busy, sending,
    onBack: async () => { events.back++ }, onRefresh: async () => { events.refresh++ },
    onAction: async (action: ResolvedButtonNode) => { const kind = fixtureActionKind(action); events[kind]++; if (kind === "contractCall") prepared = true; render() },
    onInput: (_name: string, value: string) => { draft = value; render() }, onAmount: () => {}, onInteger: () => {}, onDuration: () => {}, onDocumentHash: async () => { events.calculate++ }, onCancelDocumentHash: () => { events.cancel++ },
  }
  root.render(createElement("main", { className: "app-shell" },
    createElement(ConnectionSummary, {
      chainId: "eip155:31337", host: "0x3333333333333333333333333333333333333333",
      account: "0x1111111111111111111111111111111111111111",
      wallet: "0x2222222222222222222222222222222222222222",
      walletAction: createElement("button", { className: "wallet-button", type: "button", disabled: busy || sending, onClick: () => { events.wallet++ } }, "Reconnect wallet"),
    }),
    createElement(UiView, props),
    prepared ? createElement(PreparedCallView, { call, reviewRef: null, canSend: !busy, canDiscard: !busy && !sending, sending, onSend: async () => { events.send++ }, onDiscard: () => { prepared = false; render() } }) : null,
    transactionReport === undefined ? null : createElement("section", { className: "transaction-feedback" }, createElement(TransactionFeedback, {
      report: { message: "Confirmation could not be checked. Check the transaction before sending another.", diagnostic: "Receipt wait timed out." },
      kind: "error", transaction: transactionReport.transaction,
    })),
  ))
}
Object.assign(window, { actionFixture: { events,
  transaction(chainId: string, hash: `0x${string}` | undefined) { transactionReport = { transaction: hash === undefined ? undefined : { chainId, hash } }; render() },
  hashPhase(value: "idle" | "pending" | "succeeded") { hashPhase = value; render() }, busy(value: boolean) { busy = value; render() }, sending(value: boolean) { sending = value; render() }, draft() { return draft } } })
render()
