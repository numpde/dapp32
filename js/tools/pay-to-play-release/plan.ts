import {
  assertReleaseCamURI,
  inspectReleaseCamBundle,
} from "../release-cam-bundle.ts"
import {
  RELEASE_PLAN_SCHEMA,
  checkedClaimPeriod,
} from "./shared.ts"
import type { ReleasePlan } from "./shared.ts"
import { writeNewJson } from "../release-files.ts"
import { requiredEnv } from "../input.ts"
import {
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
  readonly intendedPaymentAdmin: ReleasePlan["intendedPaymentAdmin"]
  readonly nullClaimPeriod: number
}

function optionsFromEnv(env: NodeJS.ProcessEnv): Options {
  const camURI = requiredEnv(env, "PAY_TO_PLAY_RELEASE_CAM_URI")
  assertReleaseCamURI(camURI, "PAY_TO_PLAY_RELEASE_CAM_URI", env)

  return {
    dappsRootPath: requiredEnv(env, "PAY_TO_PLAY_RELEASE_DAPPS_ROOT"),
    rootPath: requiredEnv(env, "PAY_TO_PLAY_RELEASE_CAM_ROOT_PATH"),
    planPath: requiredEnv(env, "PAY_TO_PLAY_RELEASE_PLAN_PATH"),
    camURI,
    sourceCommit: requiredSourceCommit(requiredEnv(env, "PAY_TO_PLAY_RELEASE_SOURCE_COMMIT")),
    expectedChainId: requiredReleaseChainId(requiredEnv(env, "PAY_TO_PLAY_RELEASE_EXPECTED_CHAIN_ID")),
    nullClaimPeriod: claimPeriodFromEnv(requiredEnv(env, "PAY_TO_PLAY_RELEASE_NULL_CLAIM_PERIOD")),
    intendedPaymentAdmin: requiredNonzeroAddress(
      requiredEnv(env, "PAY_TO_PLAY_RELEASE_INTENDED_PAYMENT_ADMIN"),
      "PAY_TO_PLAY_RELEASE_INTENDED_PAYMENT_ADMIN",
    ),
    intendedCamRootOwner: requiredNonzeroAddress(
      requiredEnv(env, "PAY_TO_PLAY_RELEASE_INTENDED_CAM_ROOT_OWNER"),
      "PAY_TO_PLAY_RELEASE_INTENDED_CAM_ROOT_OWNER",
    ),
  }
}

function claimPeriodFromEnv(value: string): number {
  if (!/^(0|[1-9][0-9]*)$/.test(value)) throw new Error("null-channel claim period must be a nonnegative decimal integer")
  return checkedClaimPeriod(Number(value))
}

async function main(): Promise<void> {
  const options = optionsFromEnv(process.env)
  const bundle = await inspectReleaseCamBundle({
    dappsRootPath: options.dappsRootPath,
    rootPath: options.rootPath,
    camURI: options.camURI,
    label: "pay-to-play",
    camHash: process.env.PAY_TO_PLAY_RELEASE_CAM_HASH,
  })
  const plan: ReleasePlan = {
    intendedPaymentAdmin: options.intendedPaymentAdmin,
    nullClaimPeriod: options.nullClaimPeriod,
    schema: RELEASE_PLAN_SCHEMA,
    sourceCommit: options.sourceCommit,
    expectedChainId: options.expectedChainId,
    camURI: options.camURI,
    camHash: bundle.camHash,
    intendedCamRootOwner: options.intendedCamRootOwner,
  }
  await writeNewJson(options.planPath, plan, "release plan")
  process.stdout.write(`${JSON.stringify({
    event: "pay-to-play_release_plan",
    sourceCommit: plan.sourceCommit,
    expectedChainId: plan.expectedChainId,
    camURI: plan.camURI,
    camHash: plan.camHash,
    intendedCamRootOwner: plan.intendedCamRootOwner,
    intendedPaymentAdmin: plan.intendedPaymentAdmin,
    nullClaimPeriod: plan.nullClaimPeriod,
    planPath: options.planPath,
  })}\n`)
}

runReleaseTool(main)
