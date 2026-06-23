import { readFile } from "node:fs/promises"
import test from "node:test"

import { parseJsonText } from "@cam/protocol"
import { parseUi } from "../src/index.ts"
import { checkedInUiPaths, testCheckedInFiles } from "../../../../tests/fixtures/cam/checked-resources.mts"

test("checked-in CAM UI resources parse with the runtime UI parser", async () => {
  await testCheckedInFiles(checkedInUiPaths(), async (uiPath) => {
    const ui = parseJsonText(await readFile(uiPath, "utf8"))
    parseUi(ui)
  })
})
