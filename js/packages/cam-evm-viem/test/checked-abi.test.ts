import { readdir, readFile, stat } from "node:fs/promises"
import { join, relative } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"

import { parseAbiBytes } from "../src/abi.ts"

const dappsRoot = fileURLToPath(new URL("../../../../dapps/", import.meta.url))

test("checked-in CAM ABIs parse with the runtime EVM adapter parser", async () => {
  const abiPaths = await checkedInAbiPaths()

  for (const abiPath of abiPaths) {
    await test(relative(dappsRoot, abiPath), async () => {
      parseAbiBytes(await readFile(abiPath), abiPath)
    })
  }
})

async function checkedInAbiPaths(): Promise<string[]> {
  const dapps = await readdir(dappsRoot, { withFileTypes: true })
  const paths: string[] = []

  for (const dapp of dapps) {
    if (!dapp.isDirectory()) {
      continue
    }

    const abiDir = join(dappsRoot, dapp.name, "cam", "abi")
    if (!(await isDirectoryIfExists(abiDir))) {
      continue
    }

    for (const entry of await readdir(abiDir, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.endsWith(".json")) {
        paths.push(join(abiDir, entry.name))
      }
    }
  }

  return paths.sort()
}

async function isDirectoryIfExists(path: string): Promise<boolean> {
  let exists: boolean
  try {
    exists = (await stat(path)).isDirectory()
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
