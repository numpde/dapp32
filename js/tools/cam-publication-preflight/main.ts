import { lstat, readFile, realpath } from "node:fs/promises"
import { dirname, isAbsolute, relative, resolve, sep } from "node:path"

import { keccak256 } from "viem"

import { validateCamBundle } from "../../packages/cam-conformance/dist/index.js"
import type { CamConformanceBundle, CamConformanceIssue } from "../../packages/cam-conformance/dist/index.js"
import {
  assertCamSecondaryResourceURI,
  CAM_RESOURCE_MAX_BYTES,
  isRecordObject,
  parseJsonText,
} from "../../packages/cam-protocol/dist/index.js"

type Options = {
  readonly rootPath: string
  readonly camURI: string
  readonly json: boolean
}

type PreflightResult = {
  readonly ok: boolean
  readonly rootPath: string
  readonly camURI: string
  readonly camHash: string
  readonly resources: readonly string[]
  readonly issues: readonly CamConformanceIssue[]
}

async function main(argv: readonly string[]): Promise<number> {
  const options = parseArgs(argv)
  const result = await preflight(options)
  writeResult(result, options.json)
  return result.ok ? 0 : 1
}

async function preflight(options: Options): Promise<PreflightResult> {
  const rootPath = resolve(options.rootPath)
  await assertRegularFile(rootPath, "CAM root")

  const rootBytes = await readFile(rootPath)
  const camURI = options.camURI
  const root = parseJsonText(new TextDecoder().decode(rootBytes))
  const resources = await declaredLocalResources(rootPath, root)
  const bundle: CamConformanceBundle = {
    rootURI: camURI,
    rootBytes,
    resources,
  }
  const issues = validateCamBundle(bundle)

  return {
    ok: issues.length === 0,
    rootPath,
    camURI,
    camHash: keccak256(rootBytes),
    resources: [...resources.keys()].sort(),
    issues,
  }
}

async function declaredLocalResources(rootPath: string, root: unknown): Promise<Map<string, Uint8Array>> {
  const resources = new Map<string, Uint8Array>()
  if (!isRecordObject(root) || !isRecordObject(root.namespaces)) {
    return resources
  }

  for (const [namespaceName, namespace] of Object.entries(root.namespaces)) {
    if (!isRecordObject(namespace)) continue

    const uri = namespaceURI(namespace)
    if (uri === undefined || !uri.startsWith("./")) continue

    // Conformance owns protocol semantics; this layer only enforces local file
    // safety before reading bytes for declarations that claim to be local.
    assertCamSecondaryResourceURI(uri, `namespaces.${namespaceName}`)
    const resourcePath = await localResourcePath(rootPath, uri)

    resources.set(uri, await readFile(resourcePath))
  }

  return resources
}

function namespaceURI(namespace: Record<string, unknown>): string | undefined {
  switch (namespace.type) {
    case "contract":
      return stringValue(namespace.abiURI)
    case "ui":
      return stringValue(namespace.uri)
    default:
      return undefined
  }
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined
}

async function localResourcePath(rootPath: string, uri: string): Promise<string> {
  const rootDir = dirname(rootPath)
  const resourcePath = resolve(rootDir, uri)
  const relativePath = relative(rootDir, resourcePath)
  if (escapesRoot(relativePath)) {
    throw new Error(`local CAM resource escapes CAM directory: ${uri}`)
  }

  let currentPath = rootDir
  let resourceStat: Awaited<ReturnType<typeof lstat>> | undefined
  for (const segment of relativePath.split("/")) {
    currentPath = resolve(currentPath, segment)
    const entry = await lstat(currentPath)
    if (entry.isSymbolicLink()) {
      throw new Error(`local CAM resource path must not be symlinked: ${uri}`)
    }
    resourceStat = entry
  }

  if (resourceStat === undefined || !resourceStat.isFile()) {
    throw new Error(`local CAM resource must be a file: ${uri}`)
  }
  if (resourceStat.size > CAM_RESOURCE_MAX_BYTES) {
    throw new Error(`local CAM resource is too large: ${uri} exceeds ${CAM_RESOURCE_MAX_BYTES} bytes`)
  }

  const realRoot = await realpath(rootDir)
  const realResource = await realpath(resourcePath)
  if (escapesRoot(relative(realRoot, realResource))) {
    throw new Error(`local CAM resource escapes CAM directory after resolution: ${uri}`)
  }

  return resourcePath
}

async function assertRegularFile(path: string, label: string): Promise<void> {
  const pathStat = await lstat(path)
  if (pathStat.isSymbolicLink()) {
    throw new Error(`${label} must not be a symlink: ${path}`)
  }
  if (!pathStat.isFile()) {
    throw new Error(`${label} must be a file: ${path}`)
  }
}

function escapesRoot(path: string): boolean {
  return path === "" || path === ".." || path.startsWith(`..${sep}`) || isAbsolute(path)
}

function parseArgs(argv: readonly string[]): Options {
  let rootPath: string | undefined
  let camURI: string | undefined
  let json = false

  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index]
    switch (arg) {
      case "--root":
        rootPath = requiredArg(argv, ++index, "--root")
        break
      case "--cam-uri":
        camURI = requiredArg(argv, ++index, "--cam-uri")
        break
      case "--json":
        json = true
        break
      case "--help":
        throw new Usage()
      default:
        throw new Error(`unknown argument: ${arg}`)
    }
  }

  if (rootPath === undefined) {
    throw new Error("missing required argument: --root <path>")
  }
  if (camURI === undefined) {
    throw new Error("missing required argument: --cam-uri <published-uri>")
  }

  return {
    rootPath,
    camURI,
    json,
  }
}

function requiredArg(argv: readonly string[], index: number, flag: string): string {
  const value = argv[index]
  if (value === undefined || value.length === 0 || value.startsWith("--")) {
    throw new Error(`${flag} requires a value`)
  }

  return value
}

function writeResult(result: PreflightResult, json: boolean): void {
  if (json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
    return
  }

  if (!result.ok) {
    process.stderr.write(`cam-publication-preflight: failed with ${result.issues.length} issue(s)\n`)
    for (const issue of result.issues) {
      const path = issue.path === undefined ? "" : ` ${issue.path}`
      process.stderr.write(`${issue.rule}${path}: ${issue.message}\n`)
    }
    return
  }

  process.stdout.write("cam-publication-preflight: ok\n")
  process.stdout.write(`root=${result.rootPath}\n`)
  process.stdout.write(`CAM_URI=${result.camURI}\n`)
  process.stdout.write(`CAM_HASH=${result.camHash}\n`)
  process.stdout.write(`resources=${result.resources.length}\n`)
  for (const uri of result.resources) {
    process.stdout.write(`  ${uri}\n`)
  }
}

class Usage extends Error {}

function usage(): string {
  return [
    "usage: cam-publication-preflight --root <cam/main.json> --cam-uri <published-uri> [--json]",
    "",
    "Validates a local CAM publication bundle and prints the root CAM hash.",
    "Only local ./ secondary resources are read; remote/content-addressed resources must be materialized locally first.",
  ].join("\n")
}

try {
  await main(process.argv).then((status) => {
    process.exitCode = status
  })
} catch (error) {
  if (error instanceof Usage) {
    process.stdout.write(`${usage()}\n`)
    process.exitCode = 0
  } else {
    process.stderr.write(`cam-publication-preflight: ${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}
