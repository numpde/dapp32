import { readdir, readFile } from "node:fs/promises"
import { join, relative } from "node:path"
import { fileURLToPath } from "node:url"
import assert from "node:assert/strict"
import test from "node:test"

import { parseJsonText } from "@cam/protocol"
import { parseScreen } from "../src/index.ts"

const dappsRoot = fileURLToPath(new URL("../../../dapps/", import.meta.url))

test("checked-in CAM screens parse with the runtime screen parser", async () => {
  const screenPaths = await checkedInScreenPaths()

  assert.notEqual(screenPaths.length, 0, "expected at least one checked-in CAM screen")

  for (const screenPath of screenPaths) {
    await test(relative(dappsRoot, screenPath), async () => {
      const screen = parseJsonText(await readFile(screenPath, "utf8"))
      parseScreen(screen)
    })
  }
})

async function checkedInScreenPaths(): Promise<string[]> {
  const dapps = await readdir(dappsRoot, { withFileTypes: true })
  const paths: string[] = []

  for (const dapp of dapps) {
    if (!dapp.isDirectory()) {
      continue
    }

    const screenDir = join(dappsRoot, dapp.name, "cam", "screens")
    for (const screen of await readdirIfExists(screenDir)) {
      if (screen.isFile() && screen.name.endsWith(".json")) {
        paths.push(join(screenDir, screen.name))
      }
    }
  }

  return paths.sort()
}

async function readdirIfExists(path: string) {
  try {
    return await readdir(path, { withFileTypes: true })
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return []
    }

    throw error
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error
}
