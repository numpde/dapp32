import { createElement } from "react"
import { createRoot } from "react-dom/client"
import type { CamViewerLoadedSnapshot } from "@cam/viewer"
import { UiView } from "../src/components.tsx"
import "../src/styles.css"

const element = document.getElementById("root")
if (element === null) throw new Error("NFT fixture root is missing")
const root = createRoot(element)
const canvas = new OffscreenCanvas(2, 2)
canvas.getContext("2d")!.fillRect(0, 0, 2, 2)
const png = await canvas.convertToBlob({ type: "image/png" })
const publishedURI = "https://nft.fixture.test/metadata.json"
const metadata = { name: "Fixture NFT", description: "Prepared independently of minting", image: "https://nft.fixture.test/image.png", attributes: [{ trait_type: "Year", value: 2026, display_type: "number", extension: true }], extra: { retained: true } }
let viewerURI = `data:application/json,${encodeURIComponent(JSON.stringify(metadata))}`
const requests: string[] = []
const copies: string[] = []
let copyRejected = false
const downloads: string[] = []
const revoked: string[] = []
const blobs = new Map<string, Blob>()
const originalFetch = window.fetch.bind(window)
let held: (() => void) | undefined
let hold = false
let responseText: string | undefined
window.fetch = async (input, init) => {
  const uri = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
  requests.push(uri)
  if (uri === publishedURI) {
    if (hold) await new Promise<void>(resolve => { held = resolve })
    return new Response(responseText === undefined ? JSON.stringify(metadata) : responseText, { headers: { "content-type": "application/json" } })
  }
  if (uri === "https://nft.fixture.test/image.png") return new Response(png, { headers: { "content-type": "image/png" } })
  return originalFetch(input, init)
}
Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async (text: string) => { if (copyRejected) throw new Error("Clipboard access denied", { cause: new Error("Permission denied") }); copies.push(text) } } })
const createURL = URL.createObjectURL.bind(URL)
const revokeURL = URL.revokeObjectURL.bind(URL)
URL.createObjectURL = blob => { const uri = createURL(blob); if (blob instanceof Blob) blobs.set(uri, blob); return uri }
URL.revokeObjectURL = uri => { revoked.push(uri); blobs.delete(uri); revokeURL(uri) }
const originalClick = HTMLAnchorElement.prototype.click
HTMLAnchorElement.prototype.click = function () {
  if (this.download === "nft-metadata.json") { void blobs.get(this.href)!.text().then(text => downloads.push(text)); return }
  originalClick.call(this)
}
let tokenURI = publishedURI
let route = "fixture"
let account: `0x${string}` = "0x0000000000000000000000000000000000000001"
let busy = false
function render(): void {
  const snapshot: CamViewerLoadedSnapshot = { canGoBack: false, route, inputs: {}, account: { address: account }, state: { tokenURI, locked: publishedURI }, values: [], uiURI: "fixture", documentHashes: {}, resolvedUi: { element: "Fragment", props: {}, children: [
    { element: "Nft", props: { contractAddress: account, tokenId: "7", metadataURI: viewerURI }, children: [] },
    { element: "NftMetadataField", props: { label: "Token metadata" }, state: { key: "tokenURI" }, children: [] },
    { element: "NftMetadataField", props: { label: "Locked metadata" }, state: { key: "locked" }, disabled: true, children: [] },
  ] } }
  root.render(createElement(UiView, { snapshot, actionKind: () => "unsupported" as const, viewRef: null, changingView: busy, sending: false,
    onBack: async () => {}, onRefresh: async () => {}, onAction: async () => {},
    onInput: (name: string, value: string) => { if (name !== "tokenURI") throw new Error("Disabled input changed"); tokenURI = value; render() },
    onAmount: () => {}, onInteger: () => {}, onDuration: () => {}, onDocumentHash: async () => {}, onCancelDocumentHash: () => {},
  }))
}
Object.assign(window, { nftFixture: { requests, copies, downloads, revoked, metadata, publishedURI,
  rejectCopy(value: boolean) { copyRejected = value },
  holdMetadata() { hold = true },
  releaseMetadata() { hold = false; held?.(); held = undefined },
  response(text: string | undefined) { responseText = text },
  uri: () => tokenURI,
  source(uri: string) { viewerURI = uri; render() },
  image(uri: string) { viewerURI = `data:application/json,${encodeURIComponent(JSON.stringify({ ...metadata, image: uri }))}`; render() },
  busy(value: boolean) { busy = value; render() },
  scope(kind: "account" | "route") { if (kind === "account") account = "0x0000000000000000000000000000000000000002"; else route = "another-view"; tokenURI = publishedURI; render() },
} })
render()
