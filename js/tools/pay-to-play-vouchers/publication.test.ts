import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import test from "node:test"

// The normal JS test lane mounts the checked-in dapps tree read-only.
const directory = new URL("../../../dapps/pay-to-play/", import.meta.url)
type Field = { name: string; type: string; indexed?: boolean }
type AbiEntry = { type: string; name?: string; inputs?: Field[] }
type Declaration = { type?: string; uri?: string; abiURI?: string; integrity: string }
type Route = {
  inputs: string[]
  call: { function: string; args: Record<string, string> }
  then: { args: { view: Record<string, string> } }
}
type Manifest = { protocol: Declaration; namespaces: Record<string, Declaration>; routes: Record<string, Route> }
const voucherFields: Field[] = [
  { name: "customer", type: "address" },
  { name: "channelId", type: "uint256" },
  { name: "cumulativeTotal", type: "uint256" },
  { name: "invoiceHash", type: "bytes32" },
]

async function json<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(new URL(path, directory), "utf8")) as T
}

function inputs(abi: AbiEntry[], type: string, name: string): Field[] {
  const matches = abi.filter(entry => entry.type === type && entry.name === name)
  assert.equal(matches.length, 1, `${name} must have exactly one supported wire signature`)
  const fields = matches[0]!.inputs
  assert.ok(Array.isArray(fields))
  return fields
}

test("published ABI has invoice-bearing collection and digest only", async () => {
  const abi = await json<AbiEntry[]>("cam/abi/PayToPlay.json")
  const identity = (field: Field) => ({ name: field.name, type: field.type })
  assert.deepEqual(inputs(abi, "function", "voucherDigest").map(identity), voucherFields)
  assert.deepEqual(inputs(abi, "function", "collect").map(identity), [
    ...voucherFields, { name: "signature", type: "bytes" },
  ])
  const event = inputs(abi, "event", "VoucherCollected")
  assert.deepEqual(event.map(identity), [
    voucherFields[0], voucherFields[1], { name: "payee", type: "address" },
    { name: "amount", type: "uint256" }, { name: "voucherPaid", type: "uint256" }, voucherFields[3],
  ])
  assert.deepEqual(event.map(field => field.indexed), [true, true, true, false, false, false])
})

test("primary signing guide agrees with the published voucher schema and v2 domain", async () => {
  const guide = await readFile(new URL("README.md", directory), "utf8")
  type Example = { primaryType?: string; domain: { name: string; version: string }; types: { Voucher: Field[] }; message: Record<string, string> }
  const examples = [...guide.matchAll(/```json\r?\n([\s\S]*?)\r?\n```/g)]
    .map(match => JSON.parse(match[1]!) as Example)
    .filter(example => example.primaryType === "Voucher")
  assert.equal(examples.length, 1, "keep one complete signing example in the primary guide")
  const example = examples[0]!
  assert.equal(example.domain.name, "PayToPlay")
  assert.equal(example.domain.version, "2")
  assert.deepEqual(example.types.Voucher, voucherFields)
  assert.deepEqual(Object.keys(example.message).sort(), voucherFields.map(field => field.name).sort())
  assert.match(guide, /PAY_TO_PLAY_INVOICE_HASH=/, "manual signing must include the required invoice reference")
})

test("CAM routes require and preserve the invoice reference and declare exact resource hashes", async () => {
  const manifest = await json<Manifest>("cam/main.json")
  for (const name of ["collect", "voucherDigest"]) {
    const route = manifest.routes[name]!
    assert.deepEqual(route.inputs, name === "collect"
      ? [...voucherFields.map(field => field.name), "signature"]
      : voucherFields.map(field => field.name))
    assert.equal(route.call.function, name)
    assert.equal(route.call.args.invoiceHash, "$inputs.invoiceHash")
  }
  assert.equal(manifest.routes.voucherDigest!.then.args.view.invoiceHash, "$inputs.invoiceHash")
  for (const declaration of [manifest.protocol, manifest.namespaces["contracts.PayToPlay"]!, manifest.namespaces.ui!]) {
    const uri = declaration.type === "contract" ? declaration.abiURI : declaration.uri
    assert.equal(typeof uri, "string")
    const bytes = await readFile(new URL(uri!, new URL("cam/", directory)))
    assert.equal(declaration.integrity, `sha256:0x${createHash("sha256").update(bytes).digest("hex")}`, uri)
  }
})

function records(value: unknown, result: Record<string, unknown>[]): void {
  if (Array.isArray(value)) {
    for (const child of value) records(child, result)
  } else if (typeof value === "object" && value !== null) {
    result.push(value as Record<string, unknown>)
    for (const child of Object.values(value)) records(child, result)
  }
}

test("CAM form sends the same invoice draft to signing details and collection", async () => {
  const objects: Record<string, unknown>[] = []
  records(await json<unknown>("cam/ui.json"), objects)
  for (const name of ["collect", "voucherDigest"]) {
    const buttons = objects.filter(object => {
      const call = object.call as { namespace?: string; function?: string } | undefined
      return object.element === "Button" && call?.namespace === "routes" && call.function === name
    })
    assert.equal(buttons.length, 1, `${name} must have one form action`)
    const call = buttons[0]!.call as { args: Record<string, string> }
    assert.equal(call.args.invoiceHash, "$state.invoiceHash")
  }
  assert.equal(objects.filter(object => object.element === "TextField"
    && (object.state as { key?: string } | undefined)?.key === "invoiceHash").length, 1)
  assert.ok(objects.some(object => object.element === "Status"
    && (object.props as { value?: string } | undefined)?.value === "$view.invoiceHash"))
})
