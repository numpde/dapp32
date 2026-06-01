import { readdir, readFile, stat } from "node:fs/promises"
import { join, relative } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"

import { parseJsonText } from "@cam/protocol"
import { parseUi } from "../src/index.ts"

const dappsRoot = fileURLToPath(new URL("../../../../dapps/", import.meta.url))

test("checked-in CAM UI resources parse with the runtime UI parser", async () => {
  const uiPaths = await checkedInUiPaths()

  for (const uiPath of uiPaths) {
    await test(relative(dappsRoot, uiPath), async () => {
      const ui = parseJsonText(await readFile(uiPath, "utf8"))
      parseUi(ui)
    })
  }
})

async function checkedInUiPaths(): Promise<string[]> {
  const dapps = await readdir(dappsRoot, { withFileTypes: true })
  const paths: string[] = []

  for (const dapp of dapps) {
    if (!dapp.isDirectory()) {
      continue
    }

    const uiPath = join(dappsRoot, dapp.name, "cam", "ui.json")
    if (await isFileIfExists(uiPath)) {
      paths.push(uiPath)
    }
  }

  return paths.sort()
}

async function isFileIfExists(path: string): Promise<boolean> {
  let exists: boolean
  try {
    exists = (await stat(path)).isFile()
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      exists = false
    } else {
      throw error
    }
  }

  return exists
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error
}
