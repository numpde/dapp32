import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { dirname, relative, resolve } from "node:path"
import { pathToFileURL } from "node:url"
import test from "node:test"

import { parseJsonText } from "@cam/protocol"

import { validateCamBundle } from "../src/index.ts"
import { checkedInCamManifestPaths, dappsRoot } from "../../../../tests/fixtures/cam/checked-resources.mts"

test("checked-in CAM bundles pass conformance", async () => {
  const manifestPaths = await checkedInCamManifestPaths()

  for (const manifestPath of manifestPaths) {
    await test(relative(dappsRoot, manifestPath), async () => {
      const bundle = await checkedInBundle(manifestPath)
      assert.deepEqual(validateCamBundle(bundle), [])
    })
  }
})

async function checkedInBundle(manifestPath: string) {
  const mainBytes = await readFile(manifestPath)
  const main = parseJsonText(mainBytes.toString("utf8"))
  const resources = new Map<string, Uint8Array>()

  for (const uri of declaredLocalResourceURIs(main)) {
    resources.set(uri, await readFile(resolve(dirname(manifestPath), uri)))
  }

  return {
    mainURI: pathToFileURL(manifestPath).href,
    mainBytes,
    resources,
  }
}

function declaredLocalResourceURIs(main: unknown): readonly string[] {
  if (!isRecord(main) || !isRecord(main.namespaces)) {
    return []
  }

  const uris: string[] = []
  for (const namespace of Object.values(main.namespaces)) {
    if (!isRecord(namespace)) continue

    if (namespace.type === "contract" && typeof namespace.abiURI === "string") {
      uris.push(namespace.abiURI)
    }
    if (namespace.type === "ui" && typeof namespace.uri === "string") {
      uris.push(namespace.uri)
    }
  }

  return uris
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
