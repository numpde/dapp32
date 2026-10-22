import assert from "node:assert/strict"
import test from "node:test"
import { validateCamBundle } from "../src/index.ts"
import { minimalBundle, jsonBytes, sha256Integrity } from "./fixtures.ts"

test("CAM 1.3 publication authenticates the protocol reference as exact bytes", () => {
  const base = minimalBundle()
  const bytes = new TextEncoder().encode("<h1>CAM 1.3.0</h1>\n")
  const root = JSON.parse(new TextDecoder().decode(base.rootBytes))
  root.cam = "1.3.0"
  root.protocol = { uri: "./protocol.html", integrity: sha256Integrity(bytes) }
  const resources = new Map(base.resources)
  resources.set("./protocol.html", bytes)
  const bundle = { ...base, rootBytes: jsonBytes(root), resources }
  assert.deepEqual(validateCamBundle(bundle), [])
  resources.set("./protocol.html", new TextEncoder().encode("<h1>CAM 1.3.0</h1>"))
  assert.ok(validateCamBundle(bundle).some(issue => issue.rule === "CAM_RESOURCE_INTEGRITY_MISMATCH" && issue.path === "protocol.integrity"))
  resources.delete("./protocol.html")
  assert.ok(validateCamBundle(bundle).some(issue => issue.rule === "CAM_RESOURCE_MISSING" && issue.path === "protocol.uri"))
  delete root.protocol
  assert.ok(validateCamBundle({ ...bundle, rootBytes: jsonBytes(root) }).some(issue => issue.rule === "CAM_RESOURCE_DECLARATION_INVALID" && issue.path === "protocol"))
})
