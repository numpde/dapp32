import { readFile, readdir } from "node:fs/promises"
import { join, relative } from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"
// This fixture is typechecked from several package test projects, where the
// @cam/protocol package name is not resolvable from tests/fixtures. Import the
// source parser directly so checked-in CAM discovery still uses the one JSON
// policy that rejects duplicate keys.
import { parseJsonText } from "../../../js/packages/cam-protocol/src/json.ts"
import {
  camNamespaceResourceURIKey,
  isCamNamespaceType,
  isCamResourceNamespaceType,
} from "../../../js/packages/cam-protocol/src/manifest.ts"
import type { CamResourceNamespaceType } from "../../../js/packages/cam-protocol/src/manifest.ts"
import { localCamResourcePath } from "../../../js/tools/local-cam-files.ts"

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

export async function testCheckedInFiles(
  paths: Promise<readonly string[]> | readonly string[],
  check: (path: string) => Promise<void> | void,
): Promise<void> {
  // Subtest labels are part of the checked-in corpus contract: failures should
  // name the dapp-relative resource, not the package currently consuming it.
  for (const path of await paths) {
    await test(relative(dappsRoot, path), async () => check(path))
  }
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

async function checkedInResourcePaths(type: CamResourceNamespaceType): Promise<string[]> {
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
  readonly type: CamResourceNamespaceType
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

  if (!isCamNamespaceType(namespace.type)) {
    throw new Error(`checked-in CAM namespace has unsupported type at namespaces.${name}.type`)
  }
  if (!isCamResourceNamespaceType(namespace.type)) return undefined

  const uriKey = camNamespaceResourceURIKey(namespace.type)
  return {
    type: namespace.type,
    uri: requiredNonEmptyString(namespace[uriKey], `namespaces.${name}.${uriKey}`),
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
  return localCamResourcePath({
    rootPath,
    uri,
    uriLabel: "checked-in CAM resource URI",
    resourceLabel: `checked-in CAM resource ${uri}`,
  })
}
