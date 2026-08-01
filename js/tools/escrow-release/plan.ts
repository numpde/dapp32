import { resolve } from "node:path"

import { keccak256 } from "viem"

import {
  validateCamBundle,
} from "../../packages/cam-conformance/dist/index.js"
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
import {
  RELEASE_PLAN_SCHEMA,
  requiredEnv,
  requiredNonzeroAddress,
  requiredReleaseChainId,
  requiredSourceCommit,
  writeNewJson,
} from "./shared.ts"
import type {
  ReleasePlan,
} from "./shared.ts"

type Options = {
  readonly dappsRootPath: string
  readonly rootPath: string
  readonly planPath: string
  readonly camURI: string
  readonly sourceCommit: string
  readonly expectedChainId: number
  readonly intendedCamRootOwner: ReleasePlan["intendedCamRootOwner"]
}

export async function buildReleasePlan(options: Options): Promise<ReleasePlan> {
  const dappsRootPath = resolve(options.dappsRootPath)
  const rootPath = await checkedContainedFilePath({
    rootDir: dappsRootPath,
    path: options.rootPath,
    label: "escrow CAM root",
    boundaryLabel: "dapps root",
  })
  const rootBytes = await readBoundedFile(rootPath, "escrow CAM root")
  const root = parseJsonBytes(rootBytes)
  const resources = await declaredLocalResources(rootPath, root)
  const issues = validateCamBundle({
    rootURI: options.camURI,
    rootBytes,
    resources,
  })
  if (issues.length > 0) {
    const first = issues[0]
    throw new Error(`escrow CAM bundle does not conform: ${first?.rule}: ${first?.message}`)
  }

  return {
    schema: RELEASE_PLAN_SCHEMA,
    sourceCommit: options.sourceCommit,
    expectedChainId: options.expectedChainId,
    camURI: options.camURI,
    camHash: keccak256(rootBytes),
    intendedCamRootOwner: options.intendedCamRootOwner,
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

function optionsFromEnv(env: NodeJS.ProcessEnv): Options {
  const camURI = requiredEnv(env, "ESCROW_RELEASE_CAM_URI")
  assertPublishedCamRootURI(camURI, "ESCROW_RELEASE_CAM_URI")

  return {
    dappsRootPath: requiredEnv(env, "ESCROW_RELEASE_DAPPS_ROOT"),
    rootPath: requiredEnv(env, "ESCROW_RELEASE_CAM_ROOT_PATH"),
    planPath: requiredEnv(env, "ESCROW_RELEASE_PLAN_PATH"),
    camURI,
    sourceCommit: requiredSourceCommit(requiredEnv(env, "ESCROW_RELEASE_SOURCE_COMMIT")),
    expectedChainId: requiredReleaseChainId(requiredEnv(env, "ESCROW_RELEASE_EXPECTED_CHAIN_ID")),
    intendedCamRootOwner: requiredNonzeroAddress(
      requiredEnv(env, "ESCROW_RELEASE_CAM_ROOT_OWNER"),
      "ESCROW_RELEASE_CAM_ROOT_OWNER",
    ),
  }
}

async function main(): Promise<void> {
  const options = optionsFromEnv(process.env)
  const plan = await buildReleasePlan(options)
  await writeNewJson(options.planPath, plan, "release plan")
  process.stdout.write(`${JSON.stringify({
    event: "escrow_release_plan",
    sourceCommit: plan.sourceCommit,
    expectedChainId: plan.expectedChainId,
    camURI: plan.camURI,
    camHash: plan.camHash,
    intendedCamRootOwner: plan.intendedCamRootOwner,
    planPath: options.planPath,
  })}\n`)
}

main().catch((error: unknown) => {
  let message: string
  if (error instanceof Error && error.stack !== undefined) {
    message = error.stack
  } else if (error instanceof Error) {
    message = error.message
  } else {
    message = String(error)
  }
  process.stderr.write(`${message}\n`)
  process.exitCode = 1
})
