import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

import { isRecordObject, parseJsonBytes } from "@cam/protocol"
import { validateCamBundle } from "../src/index.ts"

const DIRECTORY = new URL("../../../../dapps/pay-to-play/cam/", import.meta.url)

test("pay-to-play CAM publication conforms with its declared ABI and UI resources", async () => {
  const rootBytes = new Uint8Array(await readFile(new URL("main.json", DIRECTORY)))
  const root = parseJsonBytes(rootBytes)
  assert.ok(isRecordObject(root))
  assert.ok(isRecordObject(root.namespaces))
  const resources = new Map<string, Uint8Array>()
  for (const declaration of [root.protocol, ...Object.values(root.namespaces)]) {
    if (!isRecordObject(declaration)) continue
    const uri = declaration.type === "contract" ? declaration.abiURI : declaration.uri
    if (typeof uri !== "string") continue
    resources.set(uri, new Uint8Array(await readFile(new URL(uri, DIRECTORY))))
  }
  assert.deepEqual(validateCamBundle({
    rootURI: "https://example.test/pay-to-play/cam/main.json",
    rootBytes,
    resources,
  }), [])
})
