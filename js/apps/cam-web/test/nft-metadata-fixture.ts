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
const revoked: string[] = []
const originalFetch = window.fetch.bind(window)
let held: (() => void) | undefined
let hold = false
let heldImage: (() => void) | undefined
let holdImage = false
let responseText: string | undefined
window.fetch = async (input, init) => {
  const uri = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
  requests.push(uri)
  if (uri === publishedURI) {
    if (hold) await new Promise<void>(resolve => { held = resolve })
    return new Response(responseText === undefined ? JSON.stringify(metadata) : responseText, { headers: { "content-type": "application/json" } })
  }
  if (uri === "https://nft.fixture.test/image.png") {
    if (holdImage) await new Promise<void>(resolve => { heldImage = resolve })
    return new Response(png, { headers: { "content-type": "image/png" } })
  }
  return originalFetch(input, init)
}
const revokeURL = URL.revokeObjectURL.bind(URL)
URL.revokeObjectURL = uri => { revoked.push(uri); revokeURL(uri) }
let tokenURI: string | null = publishedURI
let route = "fixture"
let account: `0x${string}` = "0x0000000000000000000000000000000000000001"
let busy = false
function render(): void {
  const snapshot: CamViewerLoadedSnapshot = { visitId: 1, integrityWarnings: [], canGoBack: false, route, inputs: {}, account: { address: account }, state: { tokenURI, locked: publishedURI }, values: [], uiURI: "fixture", documentHashes: {}, resolvedUi: { element: "Fragment", props: {}, children: [
    { element: "Nft", props: { contractAddress: account, tokenId: "7", metadataURI: viewerURI }, children: [] },
    { element: "NftMetadataField", props: { label: "Token metadata" }, state: { key: "tokenURI" }, children: [] },
    { element: "NftMetadataField", props: { label: "Locked metadata" }, state: { key: "locked" }, disabled: true, children: [] },
  ] } }
  root.render(createElement(UiView, { snapshot, canReviewTransaction: true, actionKind: () => "unsupported" as const, viewRef: null, changingView: busy, sending: false,
    onBack: async () => {}, onRefresh: async () => {}, onAction: async () => {},
    onInput: (name: string, value: string | null) => { if (name !== "tokenURI") throw new Error("Disabled input changed"); tokenURI = value; render() },
    onAmount: () => {}, onInteger: () => {}, onDuration: () => {}, onDocumentHash: async () => {}, onCancelDocumentHash: () => {},
  }))
}
Object.assign(window, { nftFixture: { requests, revoked, metadata, publishedURI,
  seed(uri: string) { tokenURI = uri; route = `${route}-seed`; render() },
  holdMetadata() { hold = true },
  releaseMetadata() { hold = false; held?.(); held = undefined },
  holdImage() { holdImage = true },
  releaseImage() { holdImage = false; heldImage?.(); heldImage = undefined },
  response(text: string | undefined) { responseText = text },
  uri: () => tokenURI,
  source(uri: string) { viewerURI = uri; render() },
  image(uri: string) { viewerURI = `data:application/json,${encodeURIComponent(JSON.stringify({ ...metadata, image: uri }))}`; render() },
  busy(value: boolean) { busy = value; render() },
  scope(kind: "account" | "route") { if (kind === "account") account = "0x0000000000000000000000000000000000000002"; else route = "another-view"; tokenURI = publishedURI; render() },
} })
render()
