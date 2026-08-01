import { resolve } from "node:path"

import { keccak256 } from "viem"

import {
  validateCamBundle,
} from "../../packages/cam-conformance/dist/index.js"
import {
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
import {
  RELEASE_PLAN_SCHEMA,
} from "./shared.ts"
import type {
  ReleasePlan,
} from "./shared.ts"

export type ReleaseBundleInput = {
  readonly dappsRootPath: string
  readonly rootPath: string
  readonly camURI: string
  readonly sourceCommit: string
  readonly expectedChainId: number
  readonly intendedCamRootOwner: ReleasePlan["intendedCamRootOwner"]
}

export async function buildReleasePlan(input: ReleaseBundleInput): Promise<ReleasePlan> {
  const dappsRootPath = resolve(input.dappsRootPath)
  const rootPath = await checkedContainedFilePath({
    rootDir: dappsRootPath,
    path: input.rootPath,
    label: "escrow CAM root",
    boundaryLabel: "dapps root",
  })
  const rootBytes = await readBoundedFile(rootPath, "escrow CAM root")
  const root = parseJsonBytes(rootBytes)
  const resources = await declaredLocalResources(rootPath, root)
  const issues = validateCamBundle({
    rootURI: input.camURI,
    rootBytes,
    resources,
  })
  const firstIssue = issues[0]
  if (firstIssue !== undefined) {
    throw new Error(`escrow CAM bundle does not conform: ${firstIssue.rule}: ${firstIssue.message}`)
  }

  return {
    schema: RELEASE_PLAN_SCHEMA,
    sourceCommit: input.sourceCommit,
    expectedChainId: input.expectedChainId,
    camURI: input.camURI,
    camHash: keccak256(rootBytes),
    intendedCamRootOwner: input.intendedCamRootOwner,
  }
}

async function declaredLocalResources(rootPath: string, root: unknown): Promise<Map<string, Uint8Array>> {
  const resources = new Map<string, Uint8Array>()
  if (!isRecordObject(root) || !isRecordObject(root.namespaces)) {
    return resources
  }

  for (const [namespaceName, namespace] of Object.entries(root.namespaces)) {
    if (!isRecordObject(namespace) || !isCamResourceNamespaceType(namespace.type)) continue

    const uriValue = namespace[camNamespaceResourceURIKey(namespace.type)]
    if (typeof uriValue !== "string" || !uriValue.startsWith("./")) continue

    const resourcePath = await localCamResourcePath({
      rootPath,
      uri: uriValue,
      uriLabel: `namespaces.${namespaceName}`,
    })
    resources.set(uriValue, await readBoundedFile(resourcePath, `local CAM resource ${uriValue}`))
  }

  return resources
}
