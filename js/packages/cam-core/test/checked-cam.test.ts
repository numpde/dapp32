import { readFile } from "node:fs/promises"
import test from "node:test"

import { parseJsonText } from "@cam/protocol"

import { parseCam } from "../src/index.ts"
import { checkedInCamRootPaths, testCheckedInFiles } from "../../../../tests/fixtures/cam/checked-resources.mts"

test("checked-in CAM root documents parse with the runtime CAM parser", async () => {
  await testCheckedInFiles(checkedInCamRootPaths(), async (rootPath) => {
    parseCam(parseJsonText(await readFile(rootPath, "utf8")))
  })
})
