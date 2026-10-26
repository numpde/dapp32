import { isDeepStrictEqual } from "node:util"
import { requiredEnv } from "../input.ts"
import { readBoundedRegularFile, writeNewJson } from "../release-files.ts"
import { sha256 } from "../release-approval/reference-read.ts"
import { parseJsonRecord, requireExactKeys, requiredBytes32, requiredJsonRecord, runReleaseTool } from "../release-values.ts"

// Only the launcher starts this offline writer after the keyless source verifier succeeds.
async function main(): Promise<void> {
  const candidate = parseJsonRecord(await readBoundedRegularFile(requiredEnv(process.env, "UI_RELEASE_CANDIDATE_PATH"),
    "source-checked UI candidate", 1024 * 1024), "source-checked UI candidate")
  const plan = await readBoundedRegularFile(requiredEnv(process.env, "UI_RELEASE_PLAN_PATH"), "UI release plan", 64 * 1024)
  if (candidate.schema !== "cam.ui-deployment.v1" || candidate.planSha256 !== sha256(plan)) {
    throw new Error("Cannot publish UI artifact: the candidate differs from the verified operation plan")
  }
  const output = requiredEnv(process.env, "UI_RELEASE_ARTIFACT_PATH")
  let existingBytes: Uint8Array | undefined
  try { existingBytes = await readBoundedRegularFile(output, "existing UI deployment artifact", 1024 * 1024) }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error }
  if (existingBytes !== undefined) {
    const existing = parseJsonRecord(existingBytes, "existing UI deployment artifact")
    requireExactKeys(existing, Object.keys(candidate), "existing UI deployment artifact")
    const oldBlock = requiredJsonRecord(existing.verificationBlock, "existing UI verification block")
    requireExactKeys(oldBlock, ["number", "hash"], "existing UI verification block")
    if (typeof oldBlock.number !== "string" || !/^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/.test(oldBlock.number)) {
      throw new Error("The existing UI artifact has no valid verification block number; it was left unchanged")
    }
    requiredBytes32(oldBlock.hash, "existing UI verification block hash")
    if (!isDeepStrictEqual({ ...existing, verificationBlock: candidate.verificationBlock }, candidate)) {
      throw new Error("The existing UI artifact differs from this operation's deployment; it was left unchanged")
    }
  } else {
    await writeNewJson(output, candidate, "verified UI deployment artifact")
  }
  process.stdout.write(`${JSON.stringify({ event: "ui_artifact_verified", artifactPath: output, app: candidate.app,
    sourceCommit: candidate.sourceCommit, existing: existingBytes !== undefined })}\n`)
}

runReleaseTool(main)
