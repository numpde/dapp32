import {
  assertPublishedCamRootURI,
} from "../../packages/cam-protocol/dist/index.js"

import {
  buildReleasePlan,
} from "./bundle.ts"
import type {
  ReleaseBundleInput,
} from "./bundle.ts"
import {
  requiredEnv,
  requiredNonzeroAddress,
  requiredReleaseChainId,
  requiredSourceCommit,
  writeNewJson,
} from "./shared.ts"

type Options = ReleaseBundleInput & {
  readonly planPath: string
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
