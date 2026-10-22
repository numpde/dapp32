import { createHash } from "node:crypto"
import { CAM_VERSION, UI_VERSION } from "../../../js/packages/cam-protocol/src/versions.ts"

// Proposed CAM 1.3 boundary: one optional static read invocation on a write
// route. Its outputs feed only that write's call.target and call.args. This is
// untrusted publication input, deliberately not asserted to a future CAM type.
// No resolver lists, resolver targets, nested resolution, or write resolvers.
export const resolvedTargetVersion = "1.3.0"
export const resolvedTargetURI = "https://example.test/resolved-target/main.json"
export const resolvedTargetHost = { chainId: "eip155:31337", address: "0x0000000000000000000000000000000000000001" } as const
export const resolvedTargetOwner = "0x0000000000000000000000000000000000000002"
export const resolvedTargetRecipient = "0x0000000000000000000000000000000000000003"
export const resolvedTargetManager = "0x0000000000000000000000000000000000000004"
export const oldCollection = "0x0000000000000000000000000000000000000010"
export const configuredCollection = "0x0000000000000000000000000000000000000020"
export const resolvedTargetSerial = "OLD-RECORD-123"

export const resolvedTargetManagerAbi = [
  { type: "function", name: "viewEntry", stateMutability: "view", inputs: [], outputs: [{ name: "title", type: "string" }] },
  { type: "function", name: "tokenReference", stateMutability: "view", inputs: [{ name: "serialNumber", type: "string" }], outputs: [{ name: "token", type: "address" }, { name: "tokenId", type: "uint256" }] },
] as const
export const resolvedTargetNftAbi = [{ type: "function", name: "safeTransferFrom", stateMutability: "nonpayable", inputs: [{ name: "from", type: "address" }, { name: "to", type: "address" }, { name: "tokenId", type: "uint256" }], outputs: [] }, { type: "function", name: "safeTransferFrom", stateMutability: "nonpayable", inputs: [{ name: "from", type: "address" }, { name: "to", type: "address" }, { name: "tokenId", type: "uint256" }, { name: "data", type: "bytes" }], outputs: [] }] as const

export function resolvedTargetDocument() {
  return {
    cam: resolvedTargetVersion,
    protocol: { uri: "./protocol.html", integrity: "" },
    entry: "entry",
    namespaces: {
      "contracts.Manager": { type: "contract", abiURI: "./Manager.json", integrity: "" },
      "contracts.BikeNFT": { type: "contract", abiURI: "./BikeNFT.json", integrity: "" },
      routes: { type: "routes" },
      ui: { type: "ui", uri: "./ui.json", integrity: "" },
    },
    routes: {
      entry: { kind: "read", inputs: [], call: { namespace: "contracts.Manager", function: "viewEntry", args: {} }, then: { namespace: "ui", function: "app", args: { view: "$outputs.0" } } },
      transferComponent: {
        kind: "write", inputs: ["serialNumber", "to"],
        resolve: { namespace: "contracts.Manager", function: "tokenReference", args: { serialNumber: "$inputs.serialNumber" } },
        call: { namespace: "contracts.BikeNFT", target: "$outputs.0", function: "safeTransferFrom(address,address,uint256)", args: { from: "$account.address", to: "$inputs.to", tokenId: "$outputs.1" } },
        then: { namespace: "routes", function: "entry", args: {} },
      },
    },
  }
}

export const resolvedTargetUi = {
  ui: UI_VERSION,
  nodes: { app: { element: "Screen", requires: ["view"], props: { title: "$view" }, children: [
    { element: "Button", props: { label: "Review transfer" }, call: { namespace: "routes", function: "transferComponent", args: { serialNumber: resolvedTargetSerial, to: resolvedTargetRecipient } } },
  ] } },
}
export function resolvedTargetBytes(value: unknown): Uint8Array { return new TextEncoder().encode(JSON.stringify(value)) }
export function resolvedTargetHash(bytes: Uint8Array): `0x${string}` { return `0x${createHash("sha256").update(bytes).digest("hex")}` }
export function resolvedTargetBundle(edit?: (document: ReturnType<typeof resolvedTargetDocument>) => void, managerAbi: unknown = resolvedTargetManagerAbi) {
  const document = resolvedTargetDocument()
  const resources = new Map<string, Uint8Array>([
    ["./protocol.html", new TextEncoder().encode("CAM 1.3.0 bounded resolved target test fixture")],
    ["./Manager.json", resolvedTargetBytes(managerAbi)],
    ["./BikeNFT.json", resolvedTargetBytes(resolvedTargetNftAbi)],
    ["./ui.json", resolvedTargetBytes(resolvedTargetUi)],
  ])
  const integrity = (uri: string) => `sha256:${resolvedTargetHash(resources.get(uri)!)}`
  document.protocol.integrity = integrity("./protocol.html")
  document.namespaces["contracts.Manager"].integrity = integrity("./Manager.json")
  document.namespaces["contracts.BikeNFT"].integrity = integrity("./BikeNFT.json")
  document.namespaces.ui.integrity = integrity("./ui.json")
  edit?.(document)
  return { rootURI: resolvedTargetURI, rootBytes: resolvedTargetBytes(document), resources }
}

// Positive legacy control: identical resource loading/UI/ABI harness, no new grammar.
export function makeStaticResolvedTargetDocument(document: ReturnType<typeof resolvedTargetDocument>): void {
  document.cam = CAM_VERSION
  delete (document.routes.transferComponent as Record<string, unknown>).resolve
  delete (document.routes.transferComponent.call as Record<string, unknown>).target
  document.routes.transferComponent.call.args.tokenId = "17"
}
