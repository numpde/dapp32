import { createElement } from "react"
import { createRoot } from "react-dom/client"
import { decodeFunctionData, encodeAbiParameters, encodeFunctionResult, parseAbi, sha256, toFunctionSelector, zeroAddress, zeroHash } from "viem"
import { App } from "../src/App.tsx"
import "../src/styles.css"

const scenario = new URL(location.href).searchParams.get("scenario")
const resourceBase = new URL("/connection-fixture-resources/", location.href)
const host = "0x0000000000000000000000000000000000000001"
const target = "0x0000000000000000000000000000000000000002"
const wallet = "0x0000000000000000000000000000000000000003"
const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value))
const abi = parseAbi(["function read(address subject) view returns (uint256)", "function review() view returns (address)", "function update(uint256 amount)", "function updateMetadata(string tokenURI)"])
const rootAbi = parseAbi(["function camManifest() view returns ((string uri, bytes32 sha256Digest))"])
const screen = (title: string) => ({ element: "Screen", requires: [], props: { title }, children: [
  { element: "TextField", props: { label: "Draft" }, state: { key: "draft", defaultValue: "" } },
  { element: "Button", props: { label: "Next view" }, call: { namespace: "routes", function: "detail", args: {} } },
  { element: "Button", props: { label: "Update record" }, call: { namespace: "routes", function: "update", args: {} } },
  { element: "NftMetadataField", props: { label: "NFT details" }, state: { key: "tokenURI", defaultValue: "" } },
  { element: "Button", props: { label: "Update metadata" }, call: { namespace: "routes", function: "metadata", args: { uri: "$state.tokenURI" } } },
] })
const ui = encode({ ui: "1.0.0", nodes: { home: screen("Connection fixture"), detail: screen("Connection detail") } })
const abiBytes = encode(abi)
const protocol = new TextEncoder().encode("Connection fixture protocol")
const read = (node: string) => ({ kind: "read", inputs: [], call: { namespace: "contracts.App", function: "read", args: { subject: "$account.address" } }, then: { namespace: "ui", function: node, args: {} } })
const cam = encode({ cam: "1.3.0", protocol: { uri: "./protocol.html", integrity: `sha256:${sha256(protocol)}` }, entry: "home",
  namespaces: { "contracts.App": { type: "contract", abiURI: "./abi.json", integrity: `sha256:${sha256(abiBytes)}` },
    ui: { type: "ui", uri: "./ui.json", integrity: `sha256:${sha256(ui)}` }, routes: { type: "routes" } },
  routes: { home: read("home"), detail: read("detail"), update: { kind: "write", inputs: [], resolve: { namespace: "contracts.App", function: "review", args: {} }, call: { namespace: "contracts.App", target: "$outputs.0", function: "update", args: { amount: "9007199254740993" } }, then: { namespace: "routes", function: "detail", args: {} } }, metadata: { kind: "write", inputs: ["uri"], call: { namespace: "contracts.App", function: "updateMetadata", args: { tokenURI: "$inputs.uri" } }, then: { namespace: "routes", function: "detail", args: {} } } },
})
const resources = new Map([["main.json", cam], ["protocol.html", protocol], ["abi.json", abiBytes], ["ui.json", ui]])
const state = { holdRoot: false, failRoot: false, rootDownloads: 0, rootHash: sha256(cam), holdProtocol: scenario === "unverified-held", unverifiedRoot: scenario === "unverified" || scenario === "unverified-held", protocolStarted: 0, protocolCompleted: 0, failHeldProtocol: false, tamperHeldProtocol: false, subjects: [] as string[], readOrigins: [] as string[], reviews: 0, simulations: 0, sends: 0, failAccountRead: false, holdPublicRead: scenario === "held", holdCandidate: false, candidateStarted: false, failCandidateRead: false }
const rootReads: (() => void)[] = []
let holdWallet = false
let rejectWallet: ((error: unknown) => void) | undefined
const protocolReads: (() => void)[] = []
const publicReads: (() => void)[] = []
const candidateReads: (() => void)[] = []
window.fetch = async (input, init) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url)
  if (url.origin === resourceBase.origin && url.pathname.startsWith(resourceBase.pathname)) {
    const bytes = resources.get(url.pathname.split("/").at(-1)!)
    if (bytes === undefined) throw new Error(`Unexpected fixture resource: ${url.href}`)
    if (url.pathname.endsWith("/main.json")) {
      state.rootDownloads++
      if (state.holdRoot) await new Promise<void>(resolve => rootReads.push(resolve))
      if (state.failRoot) throw new Error("Fixture manifest download failed")
    }
    if (url.pathname.endsWith("/protocol.html")) {
      state.protocolStarted++
      const held = state.holdProtocol
      if (held) await new Promise<void>(resolve => protocolReads.push(resolve))
      state.protocolCompleted++
      if (held && state.failHeldProtocol) throw new Error("Fixture protocol download failed")
      if (held && state.tamperHeldProtocol) return new Response(new TextEncoder().encode("Changed fixture protocol"))
    }
    return new Response(bytes)
  }
  if (!["https://rpc.fixture.test", "https://candidate.fixture.test", "https://next.fixture.test"].includes(url.origin)) throw new Error(`Unexpected fixture endpoint: ${url.origin}`)
  const rpc = JSON.parse(String(init?.body)) as { method: string; id: number; params: [{ data: `0x${string}` }] }
  if (url.origin === "https://candidate.fixture.test" && rpc.method === "eth_chainId" && state.holdCandidate) {
    state.candidateStarted = true
    await new Promise<void>(resolve => candidateReads.push(resolve))
    return Response.json({ jsonrpc: "2.0", id: rpc.id, result: "0xa869" })
  }
  let result: string
  if (rpc.method === "eth_chainId") result = "0x7a69"
  else if (rpc.method === "eth_getCode") result = String(rpc.params[0]).toLowerCase() === "0x0000000000000000000000000000000000000004" ? "0x" : "0x6000"
  else if (rpc.method === "eth_call") {
    const data = rpc.params[0].data
    const selector = data.slice(0, 10)
    if (selector === toFunctionSelector("supportsInterface(bytes4)")) result = encodeAbiParameters([{ type: "bool" }], [true])
    else if (selector === toFunctionSelector("camManifest()")) result = encodeFunctionResult({ abi: rootAbi, functionName: "camManifest", result: { uri: new URL("main.json", resourceBase).href, sha256Digest: state.unverifiedRoot ? zeroHash : state.rootHash } })
    else if (selector === toFunctionSelector("contractAddress(string)")) result = encodeAbiParameters([{ type: "address" }], [target])
    else if (selector === toFunctionSelector("read(address)")) {
      const decoded = decodeFunctionData({ abi, data })
      const subject = String(decoded.args?.[0])
      state.subjects.push(subject)
      state.readOrigins.push(url.origin)
      if (state.holdPublicRead && subject === zeroAddress) await new Promise<void>(resolve => publicReads.push(resolve))
      if ((scenario === "account-required" && subject === zeroAddress) || (state.failAccountRead && subject !== zeroAddress) || (state.failCandidateRead && url.origin === "https://candidate.fixture.test")) {
        return Response.json({ jsonrpc: "2.0", id: rpc.id, error: { code: -32000, message: "Fixture account read rejected" } })
      }
      result = encodeAbiParameters([{ type: "uint256" }], [7n])
    } else if (selector === toFunctionSelector("review()")) {
      state.reviews++
      result = encodeAbiParameters([{ type: "address" }], [target])
    } else if (selector === toFunctionSelector("update(uint256)") || selector === toFunctionSelector("updateMetadata(string)")) {
      state.simulations++
      result = "0x"
    } else throw new Error(`Unexpected fixture selector: ${selector}`)
  } else throw new Error(`Unexpected fixture RPC method: ${rpc.method}`)
  return Response.json({ jsonrpc: "2.0", id: rpc.id, result })
}
const listeners = new Map<string, Set<(value: unknown) => void>>()
const provider = {
  async request({ method }: { method: string }) {
    if (method === "eth_requestAccounts" || method === "eth_accounts") return [wallet]
    if (method === "eth_chainId") return "0x7a69"
    if (method === "wallet_switchEthereumChain") return null
    if (method === "eth_sendTransaction" || method === "wallet_sendTransaction") {
      state.sends++
      if (holdWallet) return new Promise<never>((_resolve, reject) => { rejectWallet = reject })
      throw new Error("The connection fixture never signs or sends transactions")
    }
    throw new Error(`Unexpected fixture wallet method: ${method}`)
  },
  on(event: string, listener: (value: unknown) => void) {
    if (!listeners.has(event)) listeners.set(event, new Set())
    listeners.get(event)!.add(listener)
  },
  removeListener(event: string, listener: (value: unknown) => void) { listeners.get(event)?.delete(listener) },
}
Object.assign(window, { ethereum: provider, connectionFixture: { state, wallet, listeners,
  holdWallet() { holdWallet = true },
  rejectWallet() { holdWallet = false; rejectWallet?.(Object.assign(new Error("Fixture wallet rejected the request"), { code: 4001 })); rejectWallet = undefined },
  replaceRoot(suffix: string) { const bytes = new Uint8Array([...cam, ...new TextEncoder().encode(suffix)]); resources.set("main.json", bytes); state.rootHash = sha256(bytes) },
  releaseRoot() { state.holdRoot = false; rootReads.splice(0).forEach(release => release()) },
  releaseProtocol() { state.holdProtocol = false; protocolReads.splice(0).forEach(release => release()) },
  releasePublicReads() { state.holdPublicRead = false; publicReads.splice(0).forEach(release => release()) },
  releaseCandidate() { state.holdCandidate = false; candidateReads.splice(0).forEach(release => release()) },
  emit(event: string, value: unknown) { listeners.get(event)?.forEach(listener => listener(value)) },
} })
const url = new URL(location.href)
url.search = new URLSearchParams({ chainId: "eip155:31337", host, rpcUrl: "https://rpc.fixture.test" }).toString()
if (scenario === "choose-rpc") url.searchParams.delete("rpcUrl")
if (scenario === "invalid-rpc") url.searchParams.set("rpcUrl", "not a URL")
if (scenario === "bare") url.search = ""
if (scenario === "partial") url.search = new URLSearchParams({ chainId: "eip155:31337", host: "needs correction", rpcUrl: "https://rpc.fixture.test" }).toString()
if (scenario === "explicit-zero") url.searchParams.set("account", zeroAddress)
history.replaceState(null, "", url)
createRoot(document.getElementById("root")!).render(createElement(App))
