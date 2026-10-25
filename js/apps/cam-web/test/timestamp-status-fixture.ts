import { createElement } from "react"
import { createRoot } from "react-dom/client"
import { parseUi, resolveUiNode } from "@cam/screen"
import type { ResolvedUiNode } from "@cam/screen"
import { UiView } from "../src/components.tsx"
import "../src/styles.css"

const element = document.getElementById("root")
if (element === null) throw new Error("Timestamp fixture root is missing")
const root = createRoot(element)
let clockSeconds = 100
Date.now = () => clockSeconds * 1000
const timers = new Set<number>()
const browser: Window = window
const startInterval = browser.setInterval.bind(browser)
const stopInterval = browser.clearInterval.bind(browser)
browser.setInterval = (handler, timeout, ...args) => {
  const timer = startInterval(handler, timeout, ...args)
  timers.add(timer)
  return timer
}
browser.clearInterval = timer => { if (timer !== undefined) timers.delete(timer); stopInterval(timer) }
const context = { host: { chainId: "eip155:31337", address: "0x0000000000000000000000000000000000000001" }, inputs: {}, outputs: [], state: {} }
function render(timestamp: ResolvedUiNode | undefined): void {
  root.render(createElement(UiView, {
    snapshot: { visitId: 1, integrityWarnings: [], canGoBack: false, route: "fixture", inputs: {}, state: { draft: "unchanged" }, values: [], uiURI: "fixture", documentHashes: {},
      resolvedUi: { element: "Fragment", props: {}, children: [
        { element: "TextField", props: { label: "Draft" }, state: { key: "draft" }, children: [] },
        { element: "Status", props: { label: "Value before timestamp", value: "Before" }, children: [] },
        ...(timestamp === undefined ? [] : [timestamp]),
        { element: "Status", props: { label: "Value after timestamp", value: "After" }, children: [] },
      ] } },
    canReviewTransaction: true, actionKind: () => "unsupported" as const, viewRef: null, changingView: false, sending: false,
    onBack: async () => {}, onRefresh: async () => {}, onAction: async () => {}, onInput: () => {},
    onAmount: () => {}, onInteger: () => {}, onDuration: () => {}, onDocumentHash: async () => {}, onCancelDocumentHash: () => {},
  }))
}
const fixture = {
  show(value: string, label: string, zeroText: string | undefined): void {
    const ui = parseUi({ ui: "1.0.0", nodes: { app: { element: "Status", requires: [], props: {
      label, value, format: "timestampSeconds", ...(zeroText === undefined ? {} : { zeroText }),
    } } } })
    render(resolveUiNode(ui, "app", {}, context))
  },
  hide(): void { render(undefined) },
  setClock(seconds: number): void { clockSeconds = seconds },
  activeTimers(): number { return timers.size },
}
Object.assign(window, { timestampFixture: fixture })
fixture.show("120", "Deadline", "No deadline")
