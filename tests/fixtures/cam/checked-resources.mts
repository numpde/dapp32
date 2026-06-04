import { lstat, readFile, readdir, realpath } from "node:fs/promises"
import { dirname, join, relative, resolve } from "node:path"
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
  return checkedInResourcePaths("ui")
}

export async function checkedInAbiPaths(): Promise<string[]> {
  return checkedInResourcePaths("contract")
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

async function checkedInResourcePaths(type: "contract" | "ui"): Promise<string[]> {
  const paths: string[] = []

  for (const rootPath of await checkedInCamRootPaths()) {
    const root = JSON.parse(await readFile(rootPath, "utf8"))
    if (!isRecord(root) || !isRecord(root.namespaces)) {
      continue
    }

    for (const namespace of Object.values(root.namespaces)) {
      if (!isRecord(namespace) || namespace.type !== type) {
        continue
      }

      const uri = resourceURI(namespace, type)
      if (uri !== undefined) {
        paths.push(await checkedInLocalResourcePath(rootPath, uri))
      }
    }
  }

  return paths.sort()
}

function resourceURI(namespace: Record<string, unknown>, type: "contract" | "ui"): string | undefined {
  const key = type === "contract" ? "abiURI" : "uri"
  const uri = namespace[key]
  if (typeof uri === "string" && uri.length > 0) {
    return uri
  }

  return undefined
}

export async function checkedInLocalResourcePath(rootPath: string, uri: string): Promise<string> {
  if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(uri) || uri.startsWith("//") || uri.startsWith("/")) {
    throw new Error(`checked-in CAM resources must be local relative files: ${uri}`)
  }
  if (!uri.startsWith("./")) {
    throw new Error(`checked-in CAM resources must use ./ local URIs: ${uri}`)
  }

  const rootDir = dirname(rootPath)
  const path = resolve(rootDir, uri)
  const relativePath = relative(rootDir, path)
  if (relativePath === "" || relativePath === ".." || relativePath.startsWith("../")) {
    throw new Error(`checked-in CAM resources must stay inside the CAM directory: ${uri}`)
  }

  let currentPath = rootDir
  for (const segment of relativePath.split("/")) {
    currentPath = resolve(currentPath, segment)
    const stat = await lstat(currentPath)
    if (stat.isSymbolicLink()) {
      throw new Error(`checked-in CAM resources must not be symlinked: ${uri}`)
    }
    if (currentPath === path && !stat.isFile()) {
      throw new Error(`checked-in CAM resource must be a file: ${uri}`)
    }
  }

  const realRoot = await realpath(rootDir)
  const realResource = await realpath(path)
  const realRelativePath = relative(realRoot, realResource)
  if (realRelativePath === "" || realRelativePath === ".." || realRelativePath.startsWith("../")) {
    throw new Error(`checked-in CAM resources must stay inside the CAM directory: ${uri}`)
  }

  return path
}
