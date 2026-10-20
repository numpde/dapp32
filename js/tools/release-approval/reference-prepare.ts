import { requiredEnv } from "../input.ts"
import { readBoundedRegularFile } from "../release-files.ts"
import { runReleaseTool } from "../release-values.ts"
import { prepareReferenceSnapshot, releaseReferenceFromPlan, writeReferenceSnapshot, type ReleaseApp } from "./reference-snapshot.ts"

function appName(value: string): ReleaseApp {
  if (value === "escrow" || value === "bike-nft" || value === "pay-to-play") return value
  throw new Error(`unsupported approval reference app: ${value}`)
}

async function main(): Promise<void> {
  const env = process.env
  const app = appName(requiredEnv(env, "RELEASE_APPROVAL_APP"))
  const planBytes = await readBoundedRegularFile(requiredEnv(env, "RELEASE_APPROVAL_PLAN_PATH"), "release plan", 64 * 1024)
  const expected = releaseReferenceFromPlan(app, planBytes, requiredEnv(env, "RELEASE_APPROVAL_EXPECTED_DEPLOYER"))
  const snapshot = await prepareReferenceSnapshot(
    app, expected, planBytes,
    requiredEnv(env, "RELEASE_APPROVAL_ARTIFACTS_ROOT"),
    requiredEnv(env, "RELEASE_APPROVAL_SOURCES_ROOT"),
  )
  const outputPath = requiredEnv(env, "RELEASE_APPROVAL_REFERENCE_PATH")
  await writeReferenceSnapshot(outputPath, snapshot)
  process.stdout.write(`${JSON.stringify({
    event: "release_approval_reference_prepared",
    app,
    sourceCommit: snapshot.sourceCommit,
    expectedChainId: snapshot.expectedChainId,
    expectedDeployer: snapshot.expectedDeployer,
    snapshotSha256: snapshot.snapshotSha256,
    outputPath,
  })}\n`)
}

runReleaseTool(main)
