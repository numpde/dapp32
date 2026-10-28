import { createElement, Fragment } from "react"
import type { ComponentProps } from "react"
import { createRoot } from "react-dom/client"
import { parseAbi } from "viem"
import { editAmountDraft, editIntegerDraft, durationDraftFromSeconds, editDurationDraft, projectAmountDraft, projectIntegerDraft, projectDurationDraft } from "@cam/screen"
import type { ResolvedButtonNode } from "@cam/screen"
import type { CamViewerLoadedSnapshot, CamViewerPreparedContractCall } from "@cam/viewer"
import { ConnectionSummary, PreparedCallView, UiView } from "../src/components.tsx"
import { Feedback, TransactionFeedback } from "../src/feedback.tsx"
import { IntegrityWarnings } from "../src/integrity-warnings.tsx"
import { BuildFooter } from "../src/build-footer.tsx"
import type { SubmittedTransactionReference, TransactionStage } from "../src/transactions.ts"
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
const fixtureDigest = `0x${"ab".repeat(32)}`
const canvas = new OffscreenCanvas(2, 2)
canvas.getContext("2d")!.fillRect(0, 0, 2, 2)
const image = await canvas.convertToBlob({ type: "image/png" })
const imageURI = `data:image/png;base64,${btoa(String.fromCharCode(...new Uint8Array(await image.arrayBuffer())))}`
const metadata = `data:application/json,${encodeURIComponent(JSON.stringify({ name: "Component preview", image: imageURI, attributes: [{ trait_type: "Document", value: fixtureDigest }] }))}`
const reviewJson = '{"name":"Fixture asset","number":123456789012345678901234567890,"note":"' + 'x'.repeat(2500) + '"}'
const reviewURI = `data:application/json;base64,${btoa(reviewJson)}`
const call: CamViewerPreparedContractCall = { route: "write", address: "0x0000000000000000000000000000000000000001", abi: parseAbi(["function fixtureWrite(address owner, bytes payload, bytes32 digest, string metadata)"]), function: "fixtureWrite", args: { owner: "0x1111111111111111111111111111111111111111", payload: fixtureDigest, digest: fixtureDigest, metadata: reviewURI }, then: { namespace: "routes", function: "read", args: {} } }
let prepared = false
let busy = false
let sending = false
let draft: string | null = "unchanged"
let viewingAccount = "0x1111111111111111111111111111111111111111"
let hashPhase: "idle" | "pending" | "succeeded" = "pending"
let transactionReport: { transaction: SubmittedTransactionReference | undefined } | undefined
const numericUnit = { assetId: "fixture:asset", baseLabel: "Base units", displayLabel: "Display units", decimals: 2 }
let integerDraft = editIntegerDraft("1")
let durationDraft = durationDraftFromSeconds("60")
let amountDraft = editAmountDraft(numericUnit, "base", "1")
const events = { navigate: 0, contractCall: 0, unsupported: 0, send: 0, wallet: 0, calculate: 0, cancel: 0, back: 0, refresh: 0 }
let buildMode = "known"
let sendStage: TransactionStage = "checking"
function fixtureActionKind(action: ResolvedButtonNode): "navigate" | "contractCall" | "unsupported" {
  const declared = actions.find(item => item.route === action.call.function)
  if (declared === undefined) throw new Error("Fixture action was not declared")
  return declared.kind
}
function render(): void {
  const integer = projectIntegerDraft(integerDraft, { min: "0", max: "100" })
  const duration = projectDurationDraft(durationDraft, { min: "0", max: "100" })
  const amount = projectAmountDraft(amountDraft)
  const snapshot: CamViewerLoadedSnapshot = { visitId: 1, integrityWarnings: [], canGoBack: true, route: "fixture", inputs: {}, state: { draft, document: "", metadata, numericCount: integer.canonical, numericWait: duration.canonical, numericAmount: amount.canonical }, values: [], uiURI: "fixture", documentHashes: hashPhase === "idle" ? {} : { document: { status: hashPhase, source: "url" } }, resolvedUi: { element: "Fragment", props: {}, children: [
    { element: "Screen", props: { title: "Overview" }, children: [
      { element: "Status", props: { label: "Availability", value: "Ready" }, children: [] },
    ] },
    { element: "Status", props: { label: "Before actions", value: "Before" }, children: [] },
    { element: "Status", props: { label: "Document digest", value: fixtureDigest }, children: [] },
    { element: "Screen", props: { title: "Fixture actions" }, children: [
      { element: "Status", props: { label: "Current account role", value: "Owner" }, children: [] },
      { element: "Text", props: { text: "These actions use the current account." }, children: [] },
      { element: "Status", props: { label: "Account permissions", value: "Available" }, children: [] },
      { element: "Screen", props: { title: "Read-only details" }, children: [
        { element: "Status", props: { label: "Position", value: "Active" }, children: [] },
      ] },
      { element: "TextField", props: { label: "Draft" }, state: { key: "draft" }, children: [] },
      ...actions.map(item => ({ element: "Button" as const, props: { label: item.label }, call: { namespace: "routes", function: item.route, args: {} }, children: [] as const, ...("disabled" in item ? { disabled: item.disabled } : {}) })),
    ] },
    { element: "Screen", props: { title: "Result" }, children: [
      { element: "Status", props: { label: "Progress", value: "Ready" }, children: [] },
    ] },
    { element: "DocumentHashField", props: { label: "Document", algorithm: "sha256", sourceURI: "https://example.test/document" }, state: { key: "document" }, children: [] },
    { element: "Nft", props: { contractAddress: "0x5555555555555555555555555555555555555555", tokenId: "42", metadataURI: metadata }, children: [] },
    { element: "NftMetadataField", props: { label: "NFT details" }, state: { key: "metadata" }, children: [] },
    { element: "NonNegativeIntegerField", props: { label: "Count", min: "0", max: "100" }, state: { key: "numericCount" }, draft: integer.draft, children: [] },
    { element: "DurationField", props: { label: "Wait", min: "0", max: "100" }, state: { key: "numericWait" }, draft: duration.draft, ...(duration.canonical === null ? {} : { formattedValue: `${duration.canonical} seconds` }), children: [] },
    { element: "AmountField", props: { label: "Amount" }, state: { key: "numericAmount" }, unit: numericUnit, draft: amount.draft, children: [] },
    { element: "Status", props: { label: "Timestamp", value: "100", format: "timestampSeconds" }, formattedValue: "1970-01-01 00:01:40 UTC (100 Unix seconds)", children: [] },
    { element: "Status", props: { label: "Unbroken".repeat(40), value: "After" }, children: [] },
  ] } }
  const props: ComponentProps<typeof UiView> = { snapshot, canReviewTransaction: true, actionKind: fixtureActionKind, viewRef: null, changingView: busy, sending,
    onBack: async () => { events.back++ }, onRefresh: async () => { events.refresh++ },
    onAction: async (action: ResolvedButtonNode) => { const kind = fixtureActionKind(action); events[kind]++; if (kind === "contractCall") prepared = true; render() },
    onInput: (_name: string, value: string | null) => { draft = value; render() }, onAmount: (_name, representation, text, options) => { amountDraft = editAmountDraft(numericUnit, representation, text, options?.composing); render() },
    onInteger: (_name, text, options) => { integerDraft = editIntegerDraft(text, options?.composing); render() },
    onDuration: (_name, part, text, options) => { durationDraft = editDurationDraft(durationDraft, part, text, options?.composing); render() }, onDocumentHash: async () => { events.calculate++ }, onCancelDocumentHash: () => { events.cancel++ },
  }
  root.render(createElement(Fragment, null, createElement("main", { className: "app-shell" },
    createElement(ConnectionSummary, {
      chainId: "eip155:31337", host: "0x3333333333333333333333333333333333333333",
      account: viewingAccount,
      wallet: "0x2222222222222222222222222222222222222222",
      walletAction: createElement("button", { className: "wallet-button", type: "button", disabled: busy || sending, onClick: () => { events.wallet++ } }, "Reconnect wallet"),
    }),
    createElement(UiView, props),
    createElement(Feedback, { report: { message: "Ready to continue." }, kind: "status", className: "notice" }),
    createElement(IntegrityWarnings, { warnings: [{ hashSource: "contract", status: "unverified", uri: "https://example.test/manifest.json", expectedHash: `0x${"00".repeat(32)}`, actualHash: fixtureDigest }, { hashSource: "manifest", status: "mismatch", uri: "https://example.test/ui.json", expectedHash: `sha256:${fixtureDigest}`, actualHash: `0x${"cd".repeat(32)}` }] }),
    prepared ? createElement(PreparedCallView, { call, reviewRef: null, canSend: !busy, canDiscard: !busy, stage: sending ? sendStage : undefined, onSend: async () => { events.send++ }, onDiscard: () => { prepared = false; render() } }) : null,
    transactionReport === undefined ? null : createElement("section", { className: "transaction-feedback" }, createElement(TransactionFeedback, {
      report: { message: "Confirmation could not be checked. Check the transaction before sending another.", diagnostic: "Receipt wait timed out." },
      kind: "error", transaction: transactionReport.transaction,
    })),
  ),
    createElement(BuildFooter, {
      revision: buildMode === "known" || buildMode === "modified" ? "0123456789abcdef0123456789abcdef01234567" : undefined,
      builtAt: buildMode === "known" || buildMode === "modified" ? "2026-01-01T01:02:03Z" : undefined,
      modified: buildMode === "modified", development: buildMode === "development",
    }),
  ))
}
Object.assign(window, { actionFixture: { events, reviewJson, reviewURI,
  stage(value: TransactionStage) { sendStage = value; sending = true; render() },
  build(mode: "known" | "modified" | "development" | "unknown") { buildMode = mode; render() },
  account(value: string) { viewingAccount = value; render() },
  transaction(chainId: string, hash: `0x${string}` | undefined) { transactionReport = { transaction: hash === undefined ? undefined : { chainId, hash } }; render() },
  hashPhase(value: "idle" | "pending" | "succeeded") { hashPhase = value; render() }, busy(value: boolean) { busy = value; render() }, sending(value: boolean) { sending = value; render() }, draft() { return draft } } })
render()
