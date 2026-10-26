import { lstat, mkdir, readdir, realpath } from "node:fs/promises"
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path"
import { sha256, type Abi, type Hex } from "viem"

import { validateCamBundle } from "../../packages/cam-conformance/dist/index.js"
import {
  camNamespaceResourceURIKey,
  isCamResourceNamespaceType,
  isRecordObject,
  parseJsonBytes,
} from "../../packages/cam-protocol/dist/index.js"
import { checkedContainedFilePath, readBoundedFile } from "../local-cam-files.ts"
import { declaredLocalResources } from "../release-cam-bundle.ts"
import { writeNewBytes } from "../release-files.ts"

export async function stageCamBundle({ dappsRootPath, rootPath, outputDir, contractABIs }: {
  readonly dappsRootPath: string
  readonly rootPath: string
  readonly outputDir: string
  readonly contractABIs: ReadonlyMap<string, Abi>
}): Promise<{
  readonly rootBytes: Uint8Array
  readonly rootSha256: Hex
  readonly authoredRootSha256: Hex
  readonly resources: ReadonlyMap<string, Uint8Array>
}> {
  const sourceRoot = resolve(dappsRootPath)
  const sourcePath = await checkedContainedFilePath({
    rootDir: sourceRoot, path: rootPath, label: "authored CAM root", boundaryLabel: "dapps root",
  })
  const authoredRootBytes = await readBoundedFile(sourcePath, "authored CAM root")
  const root = parseJsonBytes(authoredRootBytes)
  if (!isRecordObject(root) || !isRecordObject(root.namespaces)) {
    throw new Error("Cannot stage CAM bundle: authored root must declare namespaces")
  }
  const resources = await declaredLocalResources(sourcePath, root)
  const contracts = Object.entries(root.namespaces).filter(([, declaration]) =>
    isRecordObject(declaration) && declaration.type === "contract")
  const names = new Set(contracts.map(([namespace]) => namespace.slice("contracts.".length)))
  const missing = [...names].filter(name => !contractABIs.has(name))
  const extra = [...contractABIs.keys()].filter(name => !names.has(name))
  if (missing.length !== 0 || extra.length !== 0) {
    throw new Error(`Cannot stage CAM bundle: supplied ABI coverage differs from contract namespaces; missing ${JSON.stringify(missing)}, extra ${JSON.stringify(extra)}`)
  }

  const replaced = new Map<string, Uint8Array>()
  for (const [namespace, declaration] of contracts) {
    if (!isRecordObject(declaration) || !namespace.startsWith("contracts.")
        || typeof declaration.abiURI !== "string" || !resources.has(declaration.abiURI)) {
      throw new Error(`Cannot stage CAM bundle: ${namespace} must declare a local ABI resource`)
    }
    const abi = contractABIs.get(namespace.slice("contracts.".length))!
    const bytes = jsonBytes(abi, true)
    const previous = replaced.get(declaration.abiURI)
    if (previous !== undefined && !Buffer.from(previous).equals(bytes)) {
      throw new Error(`Cannot stage CAM bundle: contract namespaces select different ABIs for ${declaration.abiURI}`)
    }
    replaced.set(declaration.abiURI, bytes)
    resources.set(declaration.abiURI, bytes)
  }

  for (const declaration of Object.values(root.namespaces)) {
    if (!isRecordObject(declaration) || !isCamResourceNamespaceType(declaration.type)) continue
    const uri = declaration[camNamespaceResourceURIKey(declaration.type)]
    if (declaration.type !== "contract" && typeof uri === "string" && replaced.has(uri)) {
      throw new Error(`Cannot stage CAM bundle: non-ABI resource ${uri} shares a selected ABI path`)
    }
    if (typeof uri === "string" && resources.has(uri)) {
      declaration.integrity = `sha256:${sha256(resources.get(uri)!)}`
    }
  }
  if (isRecordObject(root.protocol) && typeof root.protocol.uri === "string" && resources.has(root.protocol.uri)) {
    if (replaced.has(root.protocol.uri)) {
      throw new Error(`Cannot stage CAM bundle: protocol resource ${root.protocol.uri} shares a selected ABI path`)
    }
    root.protocol.integrity = `sha256:${sha256(resources.get(root.protocol.uri)!)}`
  }
  const rootBytes = jsonBytes(root)
  // This base resolves local resources before hosting chooses a URI or CID.
  // Publication admission checks the eventual URI against these exact bytes.
  const issue = validateCamBundle({ rootURI: "https://cam-bundle.invalid/main.json", rootBytes, resources })[0]
  if (issue !== undefined) {
    throw new Error(`Cannot stage CAM bundle: ${issue.rule}: ${issue.message}`)
  }

  const destination = resolve(outputDir)
  const destinationStat = await lstat(destination)
  if (!destinationStat.isDirectory() || destinationStat.isSymbolicLink() || await realpath(destination) !== destination) {
    throw new Error(`Cannot stage CAM bundle: output must be a real directory without symlink ancestors: ${destination}`)
  }
  const fromSource = relative(await realpath(sourceRoot), destination)
  if (fromSource === "" || (!isAbsolute(fromSource) && fromSource !== ".." && !fromSource.startsWith(`..${sep}`))) {
    throw new Error(`Cannot stage CAM bundle: output must be outside the authored dapps tree: ${destination}`)
  }
  if ((await readdir(destination)).length !== 0) {
    throw new Error(`Cannot stage CAM bundle: output directory must be empty: ${destination}`)
  }
  const rootOutput = resolve(destination, basename(sourcePath))
  for (const uri of resources.keys()) {
    if (resolve(destination, uri) === rootOutput) {
      throw new Error(`Cannot stage CAM bundle: resource ${uri} collides with the staged root`)
    }
  }

  // Paths in resources have already passed the shared local CAM path policy.
  // Exclusive directory creation and file publication reject concurrent additions.
  const directories = new Set([destination])
  async function createParent(path: string): Promise<void> {
    if (directories.has(path)) return
    await createParent(dirname(path))
    await mkdir(path, { mode: 0o700 })
    directories.add(path)
  }
  for (const [uri, bytes] of resources) {
    const path = resolve(destination, uri)
    await createParent(dirname(path))
    await writeNewBytes(path, bytes, `staged CAM resource ${uri}`)
  }
  await writeNewBytes(rootOutput, rootBytes, "staged CAM root")
  return { rootBytes, rootSha256: sha256(rootBytes), authoredRootSha256: sha256(authoredRootBytes), resources }
}

function jsonBytes(value: unknown, sortKeys = false): Uint8Array {
  return new TextEncoder().encode(`${JSON.stringify(value, sortKeys ? (_key, item: unknown) =>
    isRecordObject(item) ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item
    : undefined, 2)}\n`)
}
