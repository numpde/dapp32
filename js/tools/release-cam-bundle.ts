import { resolve } from "node:path"

import { keccak256 } from "viem"

import { validateCamBundle } from "../packages/cam-conformance/dist/index.js"
import {
  camNamespaceResourceURIKey,
  isCamResourceNamespaceType,
  isRecordObject,
  parseJsonBytes,
} from "../packages/cam-protocol/dist/index.js"

import {
  checkedContainedFilePath,
  localCamResourcePath,
  readBoundedFile,
} from "./local-cam-files.ts"

export type InspectReleaseCamBundleOptions = {
  readonly dappsRootPath: string
  readonly rootPath: string
  readonly camURI: string
  readonly label: string
}

export async function inspectReleaseCamBundle(
  options: InspectReleaseCamBundleOptions,
): Promise<{ readonly camHash: `0x${string}` }> {
  const dappsRootPath = resolve(options.dappsRootPath)
  const rootLabel = `${options.label} CAM root`
  const rootPath = await checkedContainedFilePath({
    rootDir: dappsRootPath,
    path: options.rootPath,
    label: rootLabel,
    boundaryLabel: "dapps root",
  })
  const rootBytes = await readBoundedFile(rootPath, rootLabel)
  const root = parseJsonBytes(rootBytes)
  const resources = await declaredLocalResources(rootPath, root)
  const issue = validateCamBundle({
    rootURI: options.camURI,
    rootBytes,
    resources,
  })[0]
  if (issue !== undefined) {
    throw new Error(
      `${options.label} CAM bundle does not conform: ${issue.rule}: ${issue.message}`,
    )
  }

  return { camHash: keccak256(rootBytes) }
}

async function declaredLocalResources(
  rootPath: string,
  root: unknown,
): Promise<Map<string, Uint8Array>> {
  const resources = new Map<string, Uint8Array>()
  if (!isRecordObject(root) || !isRecordObject(root.namespaces)) {
    return resources
  }

  for (const [namespaceName, namespace] of Object.entries(root.namespaces)) {
    if (!isRecordObject(namespace) || !isCamResourceNamespaceType(namespace.type)) continue

    const uri = namespace[camNamespaceResourceURIKey(namespace.type)]
    if (typeof uri !== "string" || !uri.startsWith("./")) continue
    const resourcePath = await localCamResourcePath({
      rootPath,
      uri,
      uriLabel: `namespaces.${namespaceName}`,
    })
    resources.set(uri, await readBoundedFile(resourcePath, `local CAM resource ${uri}`))
  }

  return resources
}
