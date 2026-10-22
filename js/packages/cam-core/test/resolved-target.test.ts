import assert from "node:assert/strict"
import test from "node:test"
import { CamError, parseCam, routeRequiresAccount } from "../src/index.ts"
import { resolvedTargetDocument } from "../../../../tests/fixtures/cam/bike-resolved-target.mts"

// Grammar assertions use unknown input, not fictional exported successor types.
function document() {
  const value = resolvedTargetDocument()
  value.protocol.integrity = "sha256:fixture"
  value.namespaces["contracts.Manager"].integrity = "sha256:fixture"
  value.namespaces["contracts.BikeNFT"].integrity = "sha256:fixture"
  value.namespaces.ui.integrity = "sha256:fixture"
  return value
}

test("CAM 1.3 accepts one bounded resolver and includes the final owner in account preflight", () => {
  const parsed = parseCam(document())
  assert.equal(String(parsed.cam), "1.3.0")
  assert.equal(routeRequiresAccount(parsed, "transferComponent"), true)
  assert.equal(parsed.routes.transferComponent.kind, "write")
})

test("CAM 1.2 static writes retain their meaning and cannot acquire resolved targets", () => {
  const source = document()
  source.cam = "1.2.0"
  assert.throws(() => parseCam(source), error => error instanceof CamError && error.path !== "cam" && /resolve|target/.test(error.message))
  const route = source.routes.transferComponent as Record<string, unknown>
  delete route.resolve
  delete (route.call as Record<string, unknown>).target
  source.routes.transferComponent.call.args.tokenId = "17"
  const parsed = parseCam(source)
  assert.equal(parsed.cam, "1.2.0")
  assert.equal(routeRequiresAccount(parsed, "transferComponent"), true)
})

for (const [name, mutate] of [
  ["resolver lists", (r: Record<string, unknown>) => { r.resolve = [r.resolve] }],
  ["chained resolution", (r: Record<string, unknown>) => { (r.resolve as Record<string, unknown>).resolve = { namespace: "contracts.Manager", function: "tokenReference", args: {} } }],
  ["resolver continuation", (r: Record<string, unknown>) => { (r.resolve as Record<string, unknown>).then = { namespace: "routes", function: "entry", args: {} } }],
  ["dynamic resolver namespace", (r: Record<string, unknown>) => { (r.resolve as Record<string, unknown>).namespace = "$inputs.to" }],
  ["dynamic resolver function", (r: Record<string, unknown>) => { (r.resolve as Record<string, unknown>).function = "$inputs.serialNumber" }],
  ["resolver target override", (r: Record<string, unknown>) => { (r.resolve as Record<string, unknown>).target = "$inputs.to" }],
  ["resolver depending on prior outputs", (r: Record<string, unknown>) => { (r.resolve as Record<string, unknown>).args = { serialNumber: "$outputs.0" } }],
  ["unbound target input", (r: Record<string, unknown>) => { (r.call as Record<string, unknown>).target = "$inputs.to" }],
] as const) {
  test(`CAM 1.3 rejects ${name} at the route boundary, not the version gate`, () => {
    const source = document()
    mutate(source.routes.transferComponent)
    assert.throws(() => parseCam(source), error => error instanceof CamError && error.path?.startsWith("routes.transferComponent") === true)
  })
}

test("resolver scope is write-only and target requires an explicit resolver", () => {
  const read = document()
  Object.assign(read.routes.entry, { resolve: read.routes.transferComponent.resolve })
  assert.throws(() => parseCam(read), error => error instanceof CamError && error.path?.startsWith("routes.entry") === true)
  const missing = document()
  delete (missing.routes.transferComponent as Record<string, unknown>).resolve
  assert.throws(() => parseCam(missing), error => error instanceof CamError && error.path?.startsWith("routes.transferComponent") === true)
})

test("resolver outputs cannot become write continuation outputs", () => {
  const source = document()
  source.routes.transferComponent.then.args = { tokenId: "$outputs.1" }
  assert.throws(() => parseCam(source), error => error instanceof CamError && error.path?.startsWith("routes.transferComponent.then") === true)
})
