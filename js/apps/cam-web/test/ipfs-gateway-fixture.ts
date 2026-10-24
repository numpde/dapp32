import { createElement } from "react"
import { createRoot } from "react-dom/client"
import { encodeAbiParameters, encodeFunctionResult, parseAbi, sha256, toFunctionSelector } from "viem"
import { App } from "../src/App.tsx"
import "../src/styles.css"

const cid = "bafybeigdyrzt5sfp7udm7hu76zryo5bugubxgwf3d2wwuom2gkdcbx3zva"
const logicalRoot = `ipfs://${cid}/bundle/main.json`
const host = "0x0000000000000000000000000000000000000001"
const address = "0x0000000000000000000000000000000000000002"
const account = "0x0000000000000000000000000000000000000003"
const mode = new URL(location.href).searchParams.get("scenario") ?? "fail"
const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value))
const abi = parseAbi(["function read() view returns (uint256)"])
const rootAbi = parseAbi(["function camManifest() view returns ((string uri, bytes32 sha256Digest))"])
const screen = (title: string) => ({ element: "Screen", requires: [], props: { title }, children: [
  { element: "TextField", props: { label: "Draft" }, state: { key: "draft", defaultValue: "" } },
  { element: "Button", props: { label: "Next view" }, call: { namespace: "routes", function: "detail", args: {} } },
  { element: "Nft", props: { contractAddress: address, tokenId: "1", metadataURI: `ipfs://${cid}/metadata/nft.json` } },
] })
const uiBytes = encode({ ui: "1.0.0", nodes: { home: screen("Gateway home"), detail: screen("Gateway detail") } })
const abiBytes = encode(abi)
const protocolBytes = new TextEncoder().encode("Fixture protocol")
const route = (node: string) => ({ kind: "read", inputs: [], call: { namespace: "contracts.App", function: "read", args: {} }, then: { namespace: "ui", function: node, args: {} } })
const camBytes = encode({ cam: "1.3.0", protocol: { uri: "./protocol.html", integrity: `sha256:${sha256(protocolBytes)}` }, entry: "home",
  namespaces: { "contracts.App": { type: "contract", abiURI: "./abi.json", integrity: `sha256:${sha256(abiBytes)}` },
    ui: { type: "ui", uri: "./ui.json", integrity: `sha256:${sha256(uiBytes)}` }, routes: { type: "routes" } },
  routes: { home: route("home"), detail: route("detail") },
})
const canvas = new OffscreenCanvas(2, 2)
canvas.getContext("2d")!.fillRect(0, 0, 2, 2)
const png = await canvas.convertToBlob({ type: "image/png" })
const requests: string[] = []
let rootAttempts = 0
let aborted = 0
window.fetch = async (input, init) => {
  const href = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
  if (new URL(href).origin === "https://rpc.fixture.test") {
    const rpc = JSON.parse(String(init?.body)) as { method: string; id: number; params: [{ data?: string }] }
    let result: string
    if (rpc.method === "eth_chainId") result = "0x7a69"
    else if (rpc.method === "eth_getCode") result = "0x6000"
    else if (rpc.method === "eth_call") {
      const selector = rpc.params[0].data?.slice(0, 10)
      if (selector === toFunctionSelector("supportsInterface(bytes4)")) result = encodeAbiParameters([{ type: "bool" }], [true])
      else if (selector === toFunctionSelector("camManifest()")) result = encodeFunctionResult({ abi: rootAbi, functionName: "camManifest", result: { uri: logicalRoot, sha256Digest: sha256(camBytes) } })
      else if (selector === toFunctionSelector("contractAddress(string)")) result = encodeAbiParameters([{ type: "address" }], [address])
      else if (selector === toFunctionSelector("read()")) result = encodeAbiParameters([{ type: "uint256" }], [7n])
      else throw new Error(`Unexpected fixture contract selector: ${selector}`)
    } else throw new Error(`Unexpected fixture RPC method: ${rpc.method}`)
    return Response.json({ jsonrpc: "2.0", id: rpc.id, result })
  }
  requests.push(href)
  if (href.endsWith("/bundle/main.json")) {
    rootAttempts++
    if (rootAttempts === 1 && mode === "hold") return new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => { aborted++; reject(init.signal!.reason) }, { once: true })
    })
    if (rootAttempts === 1 && mode === "fail") return new Response("Fixture gateway unavailable", { status: 503 })
    return new Response(mode === "corrupt" ? new Uint8Array([...camBytes, 32]) : camBytes)
  }
  if (href.endsWith("/bundle/protocol.html")) return new Response(protocolBytes)
  if (href.endsWith("/bundle/abi.json")) return new Response(abiBytes)
  if (href.endsWith("/bundle/ui.json")) return new Response(uiBytes)
  if (href.endsWith("/metadata/nft.json")) return Response.json({ name: "IPFS fixture NFT", image: "../images/frame.png" })
  if (href.endsWith("/images/frame.png")) return new Response(png)
  throw new Error(`Unexpected fixture resource: ${href}`)
}
const url = new URL(location.href)
url.search = new URLSearchParams({ chainId: "eip155:31337", host, account, rpcUrl: "https://rpc.fixture.test" }).toString()
history.replaceState(null, "", url)
Object.assign(window, { gatewayFixture: { requests, get aborted() { return aborted }, logicalRoot } })
createRoot(document.getElementById("root")!).render(createElement(App))
