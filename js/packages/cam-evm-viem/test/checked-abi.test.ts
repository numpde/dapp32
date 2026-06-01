import { readFile } from "node:fs/promises"
import { relative } from "node:path"
import test from "node:test"

import { parseAbiBytes } from "../src/abi.ts"
import { checkedInAbiPaths, dappsRoot } from "../../../../tests/fixtures/cam/checked-resources.mts"

test("checked-in CAM ABIs parse with the runtime EVM adapter parser", async () => {
  const abiPaths = await checkedInAbiPaths()

  for (const abiPath of abiPaths) {
    await test(relative(dappsRoot, abiPath), async () => {
      parseAbiBytes(await readFile(abiPath), abiPath)
    })
  }
})
