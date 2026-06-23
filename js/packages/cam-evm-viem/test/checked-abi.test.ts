import { readFile } from "node:fs/promises"
import test from "node:test"

import { parseAbiBytes } from "../src/abi.ts"
import { checkedInAbiPaths, testCheckedInFiles } from "../../../../tests/fixtures/cam/checked-resources.mts"

test("checked-in CAM ABIs parse with the runtime EVM adapter parser", async () => {
  await testCheckedInFiles(checkedInAbiPaths(), async (abiPath) => {
    parseAbiBytes(await readFile(abiPath), abiPath)
  })
})
