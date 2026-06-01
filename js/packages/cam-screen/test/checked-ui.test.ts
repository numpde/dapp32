import { readFile } from "node:fs/promises"
import { relative } from "node:path"
import test from "node:test"

import { parseJsonText } from "@cam/protocol"
import { parseUi } from "../src/index.ts"
import { checkedInUiPaths, dappsRoot } from "../../../../tests/fixtures/cam/checked-resources.mts"

test("checked-in CAM UI resources parse with the runtime UI parser", async () => {
  const uiPaths = await checkedInUiPaths()

  for (const uiPath of uiPaths) {
    await test(relative(dappsRoot, uiPath), async () => {
      const ui = parseJsonText(await readFile(uiPath, "utf8"))
      parseUi(ui)
    })
  }
})
