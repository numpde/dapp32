import { requiredEnv } from "../input.ts"
import { writeNewJson } from "../release-files.ts"
import { runReleaseTool } from "../release-values.ts"
import { parseContractReleasePlan } from "./shared.ts"

async function main(): Promise<void> {
  const env = process.env
  const plan = parseContractReleasePlan(new TextEncoder().encode(JSON.stringify({
    schema: "cam.contract-release-plan.v1", app: requiredEnv(env, "CONTRACT_RELEASE_APP"),
    sourceCommit: requiredEnv(env, "CONTRACT_RELEASE_SOURCE_COMMIT"),
    expectedChainId: Number(requiredEnv(env, "CONTRACT_RELEASE_EXPECTED_CHAIN_ID")),
    settings: JSON.parse(requiredEnv(env, "CONTRACT_RELEASE_SETTINGS_JSON")),
  })))
  const planPath = requiredEnv(env, "CONTRACT_RELEASE_PLAN_PATH")
  await writeNewJson(planPath, plan, "business release plan")
  process.stdout.write(`${JSON.stringify({ event: "contract_release_plan", app: plan.app, sourceCommit: plan.sourceCommit,
    expectedChainId: plan.expectedChainId, planPath })}\n`)
}

runReleaseTool(main)
