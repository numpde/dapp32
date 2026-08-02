import {
  assertPublishedCamRootURI,
} from "../../packages/cam-protocol/dist/index.js"

import {
  buildReleasePlan,
} from "./bundle.ts"
import { parseDeploymentArtifact, requiredEnv, requiredSourceCommit, writeNewJson } from "./shared.ts"
import { readBoundedRegularFile } from "../release-files.ts"

const MAX_ARTIFACT_BYTES = 1024 * 1024

async function main(): Promise<void> {
  const artifactPath = requiredEnv(process.env, "ESCROW_DEPLOYMENT_ARTIFACT_PATH")
  const expectedSourceCommit = requiredSourceCommit(
    requiredEnv(process.env, "ESCROW_RELEASE_EXPECTED_SOURCE_COMMIT"),
  )
  const artifact = parseDeploymentArtifact(
    await readBoundedRegularFile(artifactPath, "deployment artifact", MAX_ARTIFACT_BYTES),
  )
  if (artifact.sourceCommit !== expectedSourceCommit) {
    throw new Error(
      `deployment source commit mismatch: expected ${expectedSourceCommit}, got ${artifact.sourceCommit}`,
    )
  }

  assertPublishedCamRootURI(artifact.camURI, "deployment camURI")
  const sourcePlan = await buildReleasePlan({
    dappsRootPath: requiredEnv(process.env, "ESCROW_RELEASE_DAPPS_ROOT"),
    rootPath: requiredEnv(process.env, "ESCROW_RELEASE_CAM_ROOT_PATH"),
    camURI: artifact.camURI,
    sourceCommit: artifact.sourceCommit,
    expectedChainId: artifact.chainId,
    intendedCamRootOwner: artifact.intendedCamRootOwner,
  })
  if (sourcePlan.camHash.toLowerCase() !== artifact.camHash.toLowerCase()) {
    throw new Error(
      `deployment CAM hash does not match checked-in root bytes: expected ${sourcePlan.camHash}, got ${artifact.camHash}`,
    )
  }
  await writeNewJson(
    requiredEnv(process.env, "ESCROW_VERIFIED_ARTIFACT_PATH"),
    artifact,
    "verified deployment artifact",
  )

  process.stdout.write(`${JSON.stringify({
    event: "escrow_release_input_verified",
    sourceCommit: artifact.sourceCommit,
    chainId: artifact.chainId,
    camURI: artifact.camURI,
    camHash: artifact.camHash,
    intendedCamRootOwner: artifact.intendedCamRootOwner,
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
