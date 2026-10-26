import { isDeepStrictEqual } from "node:util"
import { requiredEnv } from "../input.ts"
import { readBoundedRegularFile, writeNewJson } from "../release-files.ts"
import { sha256 } from "../release-approval/reference-read.ts"
import { runReleaseTool } from "../release-values.ts"
import { parseContractDeployment, parseContractReleasePlan } from "./shared.ts"

// The launcher gives this offline writer its private candidate only after native source verification.
async function main(): Promise<void> {
  const planBytes = await readBoundedRegularFile(requiredEnv(process.env, "CONTRACT_RELEASE_PLAN_PATH"), "business release plan", 64 * 1024)
  const plan = parseContractReleasePlan(planBytes)
  const candidate = parseContractDeployment(await readBoundedRegularFile(requiredEnv(process.env, "CONTRACT_RELEASE_CANDIDATE_PATH"),
    "source-checked business candidate", 1024 * 1024), plan.app)
  if (candidate.planSha256 !== sha256(planBytes)) {
    throw new Error("Cannot publish business artifact: its candidate differs from the verified operation plan")
  }
  const output = requiredEnv(process.env, "CONTRACT_RELEASE_ARTIFACT_PATH")
  let existing: Uint8Array | undefined
  try { existing = await readBoundedRegularFile(output, "existing business artifact", 1024 * 1024) }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error }
  if (existing !== undefined) {
    if (!isDeepStrictEqual(parseContractDeployment(existing, plan.app), candidate)) {
      throw new Error("Cannot publish business artifact: an existing record differs from this deployment and was left unchanged")
    }
  } else await writeNewJson(output, candidate, "verified business deployment artifact")
  process.stdout.write(`${JSON.stringify({ event: "contract_artifact_verified", artifactPath: output, app: plan.app,
    sourceCommit: plan.sourceCommit, existing: existing !== undefined })}\n`)
}

runReleaseTool(main)
