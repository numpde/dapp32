import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"
import { bikeCamJson, bikeCamBytes } from "../../../../tests/fixtures/cam/bike-resources.mts"
import { validateCamBundle } from "../src/index.ts"

test("Bike publication including deployment acceptances conforms to its generated ABIs and UI", async () => {
  const resources = new Map<string, Uint8Array>()
  const namespaces = bikeCamJson.namespaces as Record<string, Record<string, unknown>>
  const protocol = bikeCamJson.protocol as { uri: string }
  const declarations = [protocol, ...Object.values(namespaces)]
  for (const declaration of declarations) {
    const fields = declaration as Record<string, unknown>
    const uri = fields.type === "contract" ? fields.abiURI : fields.uri
    if (typeof uri !== "string") continue
    resources.set(uri, await readFile(new URL(`../../../../dapps/bike-nft/cam/${uri}`, import.meta.url)))
  }
  assert.deepEqual(validateCamBundle({ rootURI: "https://example.test/bike-nft/cam/main.json", rootBytes: bikeCamBytes, resources }), [])
})
