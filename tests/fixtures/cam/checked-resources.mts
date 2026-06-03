import { readFile, readdir } from "node:fs/promises"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

export const dappsRoot = fileURLToPath(new URL("../../../dapps/", import.meta.url))

export async function checkedInCamRootPaths(): Promise<string[]> {
  const dapps = await readdir(dappsRoot, { withFileTypes: true })
  const paths: string[] = []

  for (const dapp of dapps) {
    if (!dapp.isDirectory()) {
      continue
    }

    const camDir = await childDirectory(join(dappsRoot, dapp.name), "cam")
    if (camDir === undefined) {
      continue
    }

    for (const entry of await readdir(camDir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) {
        continue
      }

      const candidate = join(camDir, entry.name)
      if (await isCamRootDocument(candidate)) {
        paths.push(candidate)
      }
    }
  }

  return paths.sort()
}

export async function checkedInUiPaths(): Promise<string[]> {
  return checkedInDappCamFiles("ui.json")
}

export async function checkedInAbiPaths(): Promise<string[]> {
  const dapps = await readdir(dappsRoot, { withFileTypes: true })
  const paths: string[] = []

  for (const dapp of dapps) {
    if (!dapp.isDirectory()) {
      continue
    }

    const camDir = await childDirectory(join(dappsRoot, dapp.name), "cam")
    if (camDir === undefined) {
      continue
    }

    const abiDir = await childDirectory(camDir, "abi")
    if (abiDir === undefined) {
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

async function checkedInDappCamFiles(fileName: string): Promise<string[]> {
  const dapps = await readdir(dappsRoot, { withFileTypes: true })
  const paths: string[] = []

  for (const dapp of dapps) {
    if (!dapp.isDirectory()) {
      continue
    }

    const camDir = await childDirectory(join(dappsRoot, dapp.name), "cam")
    if (camDir === undefined) {
      continue
    }

    for (const entry of await readdir(camDir, { withFileTypes: true })) {
      if (entry.isFile() && entry.name === fileName) {
        paths.push(join(camDir, entry.name))
      }
    }
  }

  return paths.sort()
}

async function isCamRootDocument(path: string): Promise<boolean> {
  let document: unknown
  let parseFailed = false
  try {
    document = JSON.parse(await readFile(path, "utf8"))
  } catch {
    parseFailed = true
  }
  if (parseFailed) {
    return false
  }

  return isRecord(document) && typeof document.cam === "string"
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

async function childDirectory(parent: string, name: string): Promise<string | undefined> {
  for (const entry of await readdir(parent, { withFileTypes: true })) {
    if (entry.isDirectory() && entry.name === name) {
      return join(parent, entry.name)
    }
  }

  return undefined
}
