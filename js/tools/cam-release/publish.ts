import { isDeepStrictEqual } from "node:util"
import { requiredEnv } from "../input.ts"
import { readBoundedRegularFile, writeNewJson } from "../release-files.ts"
import { sha256 } from "../release-approval/reference-read.ts"
import { runReleaseTool } from "../release-values.ts"
import { parseCamReleasePlan } from "./shared.ts"
import { parseCamPublication } from "./publication.ts"

async function main(): Promise<void> {
  const env = process.env
  const planBytes = await readBoundedRegularFile(requiredEnv(env, "CAM_RELEASE_PLAN_PATH"), "CAM publication plan", 64 * 1024)
  const plan = parseCamReleasePlan(planBytes)
  const candidate = parseCamPublication(await readBoundedRegularFile(requiredEnv(env, "CAM_RELEASE_CANDIDATE_PATH"), "verified CAM publication candidate", 1024 * 1024), plan.app)
  if (candidate.planSha256 !== sha256(planBytes)) throw new Error("Cannot publish CAM artifact: candidate differs from its saved plan")
  const output = requiredEnv(env, "CAM_RELEASE_ARTIFACT_PATH")
  let existing: Uint8Array | undefined
  try { existing = await readBoundedRegularFile(output, "existing CAM publication artifact", 1024 * 1024) }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error }
  if (existing !== undefined) {
    if (!isDeepStrictEqual(parseCamPublication(existing, plan.app), candidate)) throw new Error("Cannot publish CAM artifact: an existing record differs and was left unchanged")
  } else await writeNewJson(output, candidate, "verified CAM publication artifact")
  process.stdout.write(`${JSON.stringify({ event: "cam_publication_verified", app: plan.app, root: candidate.root.contract.address,
    artifactPath: output, existing: existing !== undefined, pendingOwner: candidate.authority.pendingOwner })}\n`)
}

runReleaseTool(main)
