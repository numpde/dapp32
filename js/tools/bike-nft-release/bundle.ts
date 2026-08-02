import { resolve } from "node:path"
import { keccak256 } from "viem"
import { validateCamBundle } from "../../packages/cam-conformance/dist/index.js"
import { camNamespaceResourceURIKey, isCamResourceNamespaceType, isRecordObject, parseJsonBytes } from "../../packages/cam-protocol/dist/index.js"
import { checkedContainedFilePath, localCamResourcePath, readBoundedFile } from "../local-cam-files.ts"
import { RELEASE_PLAN_SCHEMA } from "./shared.ts"
import type { ReleasePlan } from "./shared.ts"

export type ReleaseBundleInput = Omit<ReleasePlan, "schema" | "camHash"> & { readonly dappsRootPath: string; readonly rootPath: string }

export async function buildReleasePlan(input: ReleaseBundleInput): Promise<ReleasePlan> {
  const dappsRootPath = resolve(input.dappsRootPath)
  const rootPath = await checkedContainedFilePath({ rootDir: dappsRootPath, path: input.rootPath, label: "Bike NFT CAM root", boundaryLabel: "dapps root" })
  const rootBytes = await readBoundedFile(rootPath, "Bike NFT CAM root")
  const root = parseJsonBytes(rootBytes)
  const resources = new Map<string, Uint8Array>()
  if (isRecordObject(root) && isRecordObject(root.namespaces)) {
    for (const [name, namespace] of Object.entries(root.namespaces)) {
      if (!isRecordObject(namespace) || !isCamResourceNamespaceType(namespace.type)) continue
      const uri = namespace[camNamespaceResourceURIKey(namespace.type)]
      if (typeof uri !== "string" || !uri.startsWith("./")) continue
      const path = await localCamResourcePath({ rootPath, uri, uriLabel: `namespaces.${name}` })
      resources.set(uri, await readBoundedFile(path, `local CAM resource ${uri}`))
    }
  }
  const issue = validateCamBundle({ rootURI: input.camURI, rootBytes, resources })[0]
  if (issue !== undefined) throw new Error(`Bike NFT CAM bundle does not conform: ${issue.rule}: ${issue.message}`)
  const { dappsRootPath: _dappsRootPath, rootPath: _rootPath, ...plan } = input
  return { ...plan, schema: RELEASE_PLAN_SCHEMA, camHash: keccak256(rootBytes) }
}
