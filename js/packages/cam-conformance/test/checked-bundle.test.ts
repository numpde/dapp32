import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { dirname, relative, resolve } from "node:path"
import { pathToFileURL } from "node:url"
import test from "node:test"

import { parseJsonText } from "@cam/protocol"

import { validateCamBundle } from "../src/index.ts"
import { checkedInCamRootPaths, dappsRoot } from "../../../../tests/fixtures/cam/checked-resources.mts"

test("checked-in CAM bundles pass conformance", async () => {
  const rootPaths = await checkedInCamRootPaths()

  for (const rootPath of rootPaths) {
    await test(relative(dappsRoot, rootPath), async () => {
      const bundle = await checkedInBundle(rootPath)
      assert.deepEqual(validateCamBundle(bundle), [])
    })
  }
})

async function checkedInBundle(rootPath: string) {
  const rootBytes = await readFile(rootPath)
  const root = parseJsonText(rootBytes.toString("utf8"))
  const resources = new Map<string, Uint8Array>()

  for (const uri of declaredLocalResourceURIs(root)) {
    resources.set(uri, await readFile(resolve(dirname(rootPath), uri)))
  }

  return {
    rootURI: pathToFileURL(rootPath).href,
    rootBytes,
    resources,
  }
}

function declaredLocalResourceURIs(root: unknown): readonly string[] {
  if (!isRecord(root) || !isRecord(root.namespaces)) {
    return []
  }

  const uris: string[] = []
  for (const namespace of Object.values(root.namespaces)) {
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
