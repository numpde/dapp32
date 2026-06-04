import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { relative } from "node:path"
import { pathToFileURL } from "node:url"
import test from "node:test"

import { parseJsonText } from "@cam/protocol"

import { validateCamBundle } from "../src/index.ts"
import {
  checkedInDeclaredLocalResourceURIs,
  checkedInCamRootPaths,
  checkedInLocalResourcePath,
  dappsRoot,
} from "../../../../tests/fixtures/cam/checked-resources.mts"

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

  for (const uri of checkedInDeclaredLocalResourceURIs(root)) {
    resources.set(uri, await readFile(await checkedInLocalResourcePath(rootPath, uri)))
  }

  return {
    rootURI: pathToFileURL(rootPath).href,
    rootBytes,
    resources,
  }
}
