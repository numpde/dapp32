import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"
import { isRecordObject, parseJsonBytes } from "@cam/protocol"
import { validateCamBundle } from "../src/index.ts"
import { jsonBytes, sha256Integrity } from "./fixtures.ts"

function object(value: unknown): Record<string, unknown> {
  assert(isRecordObject(value))
  return value
}

async function publication(edit: (root: Record<string, unknown>, nodes: Record<string, unknown>, abi: unknown[]) => void) {
  const directory = new URL("../../../../dapps/pay-to-play/cam/", import.meta.url)
  const root = object(parseJsonBytes(new Uint8Array(await readFile(new URL("main.json", directory)))))
  const resources = new Map<string, Uint8Array>()
  const namespaces = object(root.namespaces)
  for (const declaration of [root.protocol, ...Object.values(namespaces)]) {
    const source = object(declaration)
    const uri = source.type === "contract" ? source.abiURI : source.uri
    if (typeof uri === "string") resources.set(uri, new Uint8Array(await readFile(new URL(uri, directory))))
  }
  const uiDeclaration = object(namespaces.ui)
  const contract = object(namespaces["contracts.PayToPlay"])
  const ui = object(parseJsonBytes(resources.get(String(uiDeclaration.uri))!))
  const abi = parseJsonBytes(resources.get(String(contract.abiURI))!)
  assert(Array.isArray(abi))
  edit(root, object(ui.nodes), abi)
  const uiBytes = jsonBytes(ui)
  const abiBytes = jsonBytes(abi)
  resources.set(String(uiDeclaration.uri), uiBytes)
  resources.set(String(contract.abiURI), abiBytes)
  uiDeclaration.integrity = sha256Integrity(uiBytes)
  contract.integrity = sha256Integrity(abiBytes)
  return validateCamBundle({ rootURI: "https://example.test/cam/main.json", rootBytes: jsonBytes(root), resources })
}

test("transaction presentations join real ABI outputs, UI arguments and read-only navigation", async () => {
  assert.deepEqual(await publication(() => {}), [])
  const invalid: readonly [string, string, string, (root: Record<string, unknown>, nodes: Record<string, unknown>, abi: unknown[]) => void][] = [
    ["unknown review field", "CAM_ROUTE_INVOCATION_INVALID", "routes.collect.review.extra", root => { object(object(object(root.routes).collect).review).extra = true }],
    ["review call cannot consume outputs", "CAM_ROUTE_EXPRESSION_INVALID", "routes.collect.review.call.args.customer", root => { object(object(object(object(root.routes).collect).review).call).args = { customer: "$outputs.0", channelId: "1", actor: "$account.address" } }],
    ["review wrong output index", "CAM_ROUTE_ABI_MISMATCH", "routes.collect.review.then.args.view.amount", root => { object(object(object(object(root.routes).collect).review).then).args = { view: { amount: "$outputs.0.simulation.99", payee: "$outputs.0.read.0.payee" } } }],
    ["review wrong value type", "CAM_UI_TYPEFLOW_MISMATCH", "nodes.collectionReview.children.1.props.address", root => { object(object(object(object(root.routes).collect).review).then).args = { view: { amount: "30", payee: "$outputs.0.simulation.0" } } }],
    ["receipt missing event", "CAM_ROUTE_ABI_MISMATCH", "routes.createChannel.receipt.event", root => { object(object(object(root.routes).createChannel).receipt).event = "NotEmitted" }],
    ["receipt unknown argument", "CAM_ROUTE_ABI_MISMATCH", "routes.createChannel.receipt.then.args.view.channelId", root => { object(object(object(object(root.routes).createChannel).receipt).then).args = { view: { channelId: "$outputs.0.unknown", payee: "$outputs.0.payee", customer: "$account.address" } } }],
    ["empty receipt has no outputs", "CAM_ROUTE_EXPRESSION_INVALID", "routes.collect.receipt.empty.args.absent", root => { object(object(object(object(root.routes).collect).receipt).empty).args = { absent: "$outputs.0.amount" } }],
    ["ordinary then still has no outputs", "CAM_ROUTE_EXPRESSION_INVALID", "routes.createChannel.then.args.channelId", root => { object(object(object(root.routes).createChannel).then).args = { channelId: "$outputs.0.channelId" } }],
    ["receipt navigation cannot write", "CAM_UI_TYPEFLOW_MISMATCH", "nodes.channelCreated.children.0.call.function", (_root, nodes) => { object(nodes.channelCreated).children = [{ element: "Button", props: { label: "Create again" }, call: { namespace: "routes", function: "createChannel", args: { payee: "$view.payee", collector: "$view.payee", claimPeriod: "60" } } }] }],
    ["review cannot contain editors behind Include", "CAM_UI_TYPEFLOW_MISMATCH", "nodes.collectionReview.children.0", (_root, nodes) => { object(nodes.collectionReview).children = [{ element: "Include", call: { namespace: "ui", function: "illegalEditor", args: {} } }]; nodes.illegalEditor = { element: "TextField", props: { label: "Input" }, state: { key: "input", defaultValue: "" } } }],
    ["selected event malformed parameter", "CAM_ROUTE_ABI_MISMATCH", "routes.createChannel.receipt.event", (_root, _nodes, abi) => { object(abi.find(item => object(item).type === "event" && object(item).name === "ChannelCreated")).inputs = [null] }],
    ["selected event malformed anonymity", "CAM_ROUTE_ABI_MISMATCH", "routes.createChannel.receipt.event", (_root, _nodes, abi) => { object(abi.find(item => object(item).type === "event" && object(item).name === "ChannelCreated")).anonymous = "false" }],
    ["selected event invalid ABI type", "CAM_ABI_INVALID", "routes.createChannel.receipt.event.inputs.0", (_root, _nodes, abi) => { const event = object(abi.find(item => object(item).type === "event" && object(item).name === "ChannelCreated")); const inputs = event.inputs; assert(Array.isArray(inputs)); object(inputs[0]).type = "uint257" }],
    ["presentation root must be unambiguous", "CAM_UI_TYPEFLOW_MISMATCH", "nodes.channelCreated.call.function", (_root, nodes) => { nodes.channelCreated = { element: "Include", requires: ["view"], call: { namespace: "ui", function: ["one", "two"], args: {} } }; for (const name of ["one", "two"]) nodes[name] = { element: "Screen", props: { title: name }, children: [] } }],
  ]
  for (const [name, rule, path, edit] of invalid) {
    const issues = await publication(edit)
    assert(issues.some(issue => issue.rule === rule && issue.path?.startsWith(path)), `${name}: ${JSON.stringify(issues)}`)
  }
})

test("presentation handoffs may forward their complete structured outputs", async () => {
  assert.deepEqual(await publication((root, nodes) => {
    const collect = object(object(root.routes).collect)
    object(object(collect.receipt).then).args = { view: "$outputs.0" }
    object(object(collect.review).then).args = { view: "$outputs.0" }
    object(nodes.collectionReview).children = [
      { element: "Status", props: { label: "Estimate", value: "$view.simulation.0" } },
      { element: "Address", props: { label: "Payee", address: "$view.read.0.payee" } },
    ]
  }), [])
})
