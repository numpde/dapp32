import {
  assertPublishedCamRootURI,
} from "../../packages/cam-protocol/dist/index.js"

import {
  inspectReleaseCamBundle,
} from "../release-cam-bundle.ts"
import {
  RELEASE_PLAN_SCHEMA,
} from "./shared.ts"
import type { ReleasePlan } from "./shared.ts"
import { writeNewJson } from "../release-files.ts"
import {
  requiredEnv,
  requiredNonzeroAddress,
  requiredReleaseChainId,
  requiredSourceCommit,
  runReleaseTool,
} from "../release-values.ts"

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
      requiredEnv(env, "ESCROW_RELEASE_INTENDED_CAM_ROOT_OWNER"),
      "ESCROW_RELEASE_INTENDED_CAM_ROOT_OWNER",
    ),
  }
}

async function main(): Promise<void> {
  const options = optionsFromEnv(process.env)
  const bundle = await inspectReleaseCamBundle({
    dappsRootPath: options.dappsRootPath,
    rootPath: options.rootPath,
    camURI: options.camURI,
    label: "escrow",
  })
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

runReleaseTool(main)
