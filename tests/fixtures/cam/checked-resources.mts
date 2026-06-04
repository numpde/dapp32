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

    const rootPath = await childFile(camDir, "main.json")
    if (rootPath === undefined) {
      throw new Error(`checked-in CAM directory is missing root manifest: ${camDir}/main.json`)
    }
    assertCamRootDocument(rootPath, JSON.parse(await readFile(rootPath, "utf8")))
    paths.push(rootPath)
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

function assertCamRootDocument(path: string, document: unknown): void {
  if (isRecord(document) && typeof document.cam === "string") {
    return
  }

  throw new Error(`checked-in CAM root manifest must declare cam version: ${path}`)
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

async function childFile(parent: string, name: string): Promise<string | undefined> {
  for (const entry of await readdir(parent, { withFileTypes: true })) {
    if (entry.isFile() && entry.name === name) {
      return join(parent, entry.name)
    }
  }

  return undefined
}
