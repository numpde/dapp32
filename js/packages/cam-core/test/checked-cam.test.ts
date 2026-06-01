import { readdir, readFile, stat } from "node:fs/promises"
import { join, relative } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"

import { parseJsonText } from "@cam/protocol"

import { parseCam } from "../src/index.ts"

const dappsRoot = fileURLToPath(new URL("../../../../dapps/", import.meta.url))

test("checked-in CAM manifests parse with the runtime CAM parser", async () => {
  const manifestPaths = await checkedInCamManifestPaths()

  for (const manifestPath of manifestPaths) {
    await test(relative(dappsRoot, manifestPath), async () => {
      parseCam(parseJsonText(await readFile(manifestPath, "utf8")))
    })
  }
})

async function checkedInCamManifestPaths(): Promise<string[]> {
  const dapps = await readdir(dappsRoot, { withFileTypes: true })
  const paths: string[] = []

  for (const dapp of dapps) {
    if (!dapp.isDirectory()) {
      continue
    }

    const manifestPath = join(dappsRoot, dapp.name, "cam", "main.json")
    if (await isFileIfExists(manifestPath)) {
      paths.push(manifestPath)
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
