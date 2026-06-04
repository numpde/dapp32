import { lstat, readFile, readdir, realpath } from "node:fs/promises"
import { dirname, join, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"
// This fixture is typechecked from several package test projects, where the
// @cam/protocol package name is not resolvable from tests/fixtures. Import the
// source parser directly so checked-in CAM discovery still uses the one JSON
// policy that rejects duplicate keys.
import { parseJsonText } from "../../../js/packages/cam-protocol/src/json.ts"

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
    assertCamRootDocument(rootPath, parseJsonText(await readFile(rootPath, "utf8")))
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

export function checkedInDeclaredLocalResourceURIs(root: unknown): readonly string[] {
  return checkedInLocalResourceDeclarations(root).map((declaration) => declaration.uri)
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
    const root = parseJsonText(await readFile(rootPath, "utf8"))
    for (const declaration of checkedInLocalResourceDeclarations(root)) {
      if (declaration.type === type) {
        paths.push(await checkedInLocalResourcePath(rootPath, declaration.uri))
      }
    }
  }

  return paths.sort()
}

type LocalResourceDeclaration = {
  readonly type: "contract" | "ui"
  readonly uri: string
}

function checkedInLocalResourceDeclarations(root: unknown): readonly LocalResourceDeclaration[] {
  const source = requiredRecord(root, "CAM root")
  const namespaces = requiredRecord(source.namespaces, "namespaces")
  const declarations: LocalResourceDeclaration[] = []

  for (const [name, namespace] of Object.entries(namespaces)) {
    const declaration = localResourceDeclaration(name, namespace)
    if (declaration !== undefined) {
      declarations.push(declaration)
    }
  }

  return declarations
}

function localResourceDeclaration(name: string, value: unknown): LocalResourceDeclaration | undefined {
  const namespace = requiredRecord(value, `namespaces.${name}`)

  switch (namespace.type) {
    case "contract":
      return {
        type: "contract",
        uri: requiredNonEmptyString(namespace.abiURI, `namespaces.${name}.abiURI`),
      }
    case "ui":
      return {
        type: "ui",
        uri: requiredNonEmptyString(namespace.uri, `namespaces.${name}.uri`),
      }
    case "routes":
      return undefined
    default:
      throw new Error(`checked-in CAM namespace has unsupported type at namespaces.${name}.type`)
  }
}

function requiredRecord(value: unknown, path: string): Record<string, unknown> {
  if (isRecord(value)) {
    return value
  }

  throw new Error(`checked-in CAM value must be an object: ${path}`)
}

function requiredNonEmptyString(value: unknown, path: string): string {
  if (typeof value === "string" && value.length > 0) {
    return value
  }

  throw new Error(`checked-in CAM value must be a non-empty string: ${path}`)
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
