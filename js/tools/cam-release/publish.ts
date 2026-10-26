import { isDeepStrictEqual } from "node:util"
import { requiredEnv } from "../input.ts"
import { readBoundedRegularFile, writeNewJson } from "../release-files.ts"
import { sha256 } from "../release-approval/reference-read.ts"
import { parseJsonRecord, runReleaseTool } from "../release-values.ts"
import { parseCamReleasePlan } from "./shared.ts"
import { parseCamPublication, parseCamAttempt } from "./publication.ts"

async function main(): Promise<void> {
  const env = process.env
  const planBytes = await readBoundedRegularFile(requiredEnv(env, "CAM_RELEASE_PLAN_PATH"), "CAM publication plan", 64 * 1024)
  const plan = parseCamReleasePlan(planBytes)
  const bytes = await readBoundedRegularFile(requiredEnv(env, "CAM_RELEASE_CANDIDATE_PATH"), "verified CAM publication candidate", 1024 * 1024)
  const incomplete = parseJsonRecord(bytes, "CAM publication candidate").schema === "cam.publication-attempt.v1"
  const parse = incomplete ? parseCamAttempt : parseCamPublication
  const candidate = parse(bytes, plan.app)
  if (candidate.planSha256 !== sha256(planBytes)) throw new Error("Cannot publish CAM artifact: candidate differs from its saved plan")
  const output = requiredEnv(env, incomplete ? "CAM_RELEASE_ATTEMPT_PATH" : "CAM_RELEASE_ARTIFACT_PATH")
  let existing: Uint8Array | undefined
  try { existing = await readBoundedRegularFile(output, "existing CAM publication artifact", 1024 * 1024) }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error }
  if (existing !== undefined) {
    if (!isDeepStrictEqual(parse(existing, plan.app), candidate)) throw new Error("Cannot publish CAM artifact: an existing record differs and was left unchanged")
  } else await writeNewJson(output, candidate, "verified CAM publication artifact")
  process.stdout.write(`${JSON.stringify({ event: incomplete ? "cam_publication_incomplete" : "cam_publication_verified", app: plan.app, root: candidate.root.contract.address,
    artifactPath: output, existing: existing !== undefined, pendingOwner: candidate.authority.pendingOwner })}\n`)
  if (incomplete) process.exitCode = 3
}

runReleaseTool(main)
