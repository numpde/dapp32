import { resolve } from "node:path"

import { keccak256 } from "viem"

import { validateCamBundle } from "../../packages/cam-conformance/dist/index.js"
import type { CamConformanceBundle, CamConformanceIssue } from "../../packages/cam-conformance/dist/index.js"
import {
  assertPublishedCamRootURI,
  camNamespaceResourceURIKey,
  isCamResourceNamespaceType,
  isRecordObject,
  parseJsonBytes,
} from "../../packages/cam-protocol/dist/index.js"
import {
  checkedContainedFilePath,
  localCamResourcePath,
  readBoundedFile,
} from "../local-cam-files.ts"

type Options = {
  readonly dappsRootPath: string
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

type ResourceDiscoveryRoot =
  | { readonly ok: true, readonly value: unknown }
  | { readonly ok: false }

const MAX_HUMAN_OUTPUT_FIELD_LENGTH = 1_000

async function main(argv: readonly string[]): Promise<number> {
  const options = parseArgs(argv)
  const result = await preflight(options)
  writeResult(result, options.json)
  return result.ok ? 0 : 1
}

async function preflight(options: Options): Promise<PreflightResult> {
  const dappsRootPath = resolve(options.dappsRootPath)
  const rootPath = await checkedContainedFilePath({
    rootDir: dappsRootPath,
    path: options.rootPath,
    label: "CAM root",
    boundaryLabel: "dapps root",
  })

  const rootBytes = await readBoundedFile(rootPath, "CAM root")
  const camURI = options.camURI
  assertPublishedCamRootURI(camURI, "CAM URI")
  const discoveryRoot = rootForLocalResourceDiscovery(rootBytes)
  const resources = discoveryRoot.ok
    ? await declaredLocalResources(rootPath, discoveryRoot.value)
    : new Map<string, Uint8Array>()
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

function rootForLocalResourceDiscovery(bytes: Uint8Array): ResourceDiscoveryRoot {
  try {
    return { ok: true, value: parseJsonBytes(bytes) }
  } catch {
    // Root JSON validity is reported by @cam/conformance below. Resource
    // discovery is only a local file-collection convenience, so it should not
    // preempt structured author diagnostics for the root document itself.
    return { ok: false }
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

    const resourcePath = await localCamResourcePath({
      rootPath,
      uri,
      uriLabel: `namespaces.${namespaceName}`,
    })

    resources.set(uri, await readBoundedFile(resourcePath, `local CAM resource ${uri}`))
  }

  return resources
}

function namespaceURI(namespace: Record<string, unknown>): string | undefined {
  if (!isCamResourceNamespaceType(namespace.type)) return undefined

  return stringValue(namespace[camNamespaceResourceURIKey(namespace.type)])
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined
}

function parseArgs(argv: readonly string[]): Options {
  let dappsRootPath: string | undefined
  let rootPath: string | undefined
  let camURI: string | undefined
  let json = false

  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index]
    switch (arg) {
      case "--dapps-root":
        dappsRootPath = assignOnce(dappsRootPath, requiredArg(argv, ++index, "--dapps-root"), "--dapps-root")
        break
      case "--root":
        rootPath = assignOnce(rootPath, requiredArg(argv, ++index, "--root"), "--root")
        break
      case "--cam-uri":
        camURI = assignOnce(camURI, requiredArg(argv, ++index, "--cam-uri"), "--cam-uri")
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
  if (dappsRootPath === undefined) {
    throw new Error("missing required argument: --dapps-root <path>")
  }
  if (camURI === undefined) {
    throw new Error("missing required argument: --cam-uri <published-uri>")
  }

  return {
    dappsRootPath,
    rootPath,
    camURI,
    json,
  }
}

function assignOnce(current: string | undefined, next: string, flag: string): string {
  if (current !== undefined) {
    throw new Error(`${flag} must be provided at most once`)
  }

  return next
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
      const path = issue.path === undefined ? "" : ` ${humanOutputField(issue.path)}`
      process.stderr.write(`${issue.rule}${path}: ${humanOutputField(issue.message)}\n`)
    }
    return
  }

  process.stdout.write("cam-publication-preflight: ok\n")
  process.stdout.write(`root=${humanOutputField(result.rootPath)}\n`)
  process.stdout.write(`CAM_URI=${humanOutputField(result.camURI)}\n`)
  process.stdout.write(`CAM_HASH=${humanOutputField(result.camHash)}\n`)
  process.stdout.write(`resources=${result.resources.length}\n`)
  for (const uri of result.resources) {
    process.stdout.write(`  ${humanOutputField(uri)}\n`)
  }
}

class Usage extends Error {}

function usage(): string {
  return [
    "usage: cam-publication-preflight --dapps-root <dapps-root> --root <cam/main.json> --cam-uri <https-or-ipfs-uri> [--json]",
    "",
    "Validates a local CAM publication bundle and prints the root CAM hash.",
    "This repo CLI reads repo-local ./ secondary resources only; use @cam/conformance directly for externally assembled bundles.",
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
    writeFatalError(error, process.argv.includes("--json"))
    process.exitCode = 1
  }
}

function writeFatalError(error: unknown, json: boolean): void {
  const message = fatalErrorMessage(error)
  if (json) {
    // JSON mode is for automation. Keep even operator/file failures parseable;
    // build logs stay on stderr in the Compose wrapper.
    process.stdout.write(`${JSON.stringify({ ok: false, error: message }, null, 2)}\n`)
    return
  }

  process.stderr.write(`cam-publication-preflight: ${humanOutputField(message)}\n`)
}

function fatalErrorMessage(error: unknown): string {
  try {
    return error instanceof Error ? error.message : String(error)
  } catch {
    return "unprintable error"
  }
}

function humanOutputField(value: string): string {
  // Human stderr is for CI/operator logs. JSON mode above remains complete for
  // automation; text mode should not flood logs with manifest-controlled text.
  return value.length <= MAX_HUMAN_OUTPUT_FIELD_LENGTH
    ? value
    : `${value.slice(0, MAX_HUMAN_OUTPUT_FIELD_LENGTH)}...`
}
