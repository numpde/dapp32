import {
  assertPublishedCamRootURI,
} from "../../packages/cam-protocol/dist/index.js"

import {
  inspectReleaseBundle,
} from "./bundle.ts"
import {
  RELEASE_PLAN_SCHEMA,
  requiredEnv,
  requiredNonzeroAddress,
  requiredReleaseChainId,
  requiredSourceCommit,
  writeNewJson,
} from "./shared.ts"
import type { ReleasePlan } from "./shared.ts"

type Options = {
  readonly dappsRootPath: string
  readonly rootPath: string
  readonly planPath: string
  readonly camURI: string
  readonly sourceCommit: string
  readonly expectedChainId: number
  readonly intendedCamRootOwner: ReleasePlan["intendedCamRootOwner"]
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
  const bundle = await inspectReleaseBundle(options)
  const plan: ReleasePlan = {
    schema: RELEASE_PLAN_SCHEMA,
    sourceCommit: options.sourceCommit,
    expectedChainId: options.expectedChainId,
    camURI: options.camURI,
    camHash: bundle.camHash,
    intendedCamRootOwner: options.intendedCamRootOwner,
  }
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
