import { readFile } from "node:fs/promises"
import { relative } from "node:path"
import test from "node:test"

import { parseJsonText } from "@cam/protocol"

import { parseCam } from "../src/index.ts"
import { checkedInCamManifestPaths, dappsRoot } from "../../../../tests/fixtures/cam/checked-resources.mts"

test("checked-in CAM manifests parse with the runtime CAM parser", async () => {
  const manifestPaths = await checkedInCamManifestPaths()

  for (const manifestPath of manifestPaths) {
    await test(relative(dappsRoot, manifestPath), async () => {
      parseCam(parseJsonText(await readFile(manifestPath, "utf8")))
    })
  }
})
