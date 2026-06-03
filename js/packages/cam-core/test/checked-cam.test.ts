import { readFile } from "node:fs/promises"
import { relative } from "node:path"
import test from "node:test"

import { parseJsonText } from "@cam/protocol"

import { parseCam } from "../src/index.ts"
import { checkedInCamRootPaths, dappsRoot } from "../../../../tests/fixtures/cam/checked-resources.mts"

test("checked-in CAM root documents parse with the runtime CAM parser", async () => {
  const rootPaths = await checkedInCamRootPaths()

  for (const rootPath of rootPaths) {
    await test(relative(dappsRoot, rootPath), async () => {
      parseCam(parseJsonText(await readFile(rootPath, "utf8")))
    })
  }
})
