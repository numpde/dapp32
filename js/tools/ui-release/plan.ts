import { createPublicClient, http } from "viem"
import { requiredEnv } from "../input.ts"
import { readBoundedRegularFile, writeNewJson } from "../release-files.ts"
import { checkedReleaseChainId, requiredSourceCommit, runReleaseTool } from "../release-values.ts"
import { backingFromDeployment, parseUIReleasePlan, verifyUIBacking } from "./shared.ts"

async function main(): Promise<void> {
  const env = process.env
  const app = requiredEnv(env, "UI_RELEASE_APP")
  if (app !== "bike-nft" && app !== "escrow" && app !== "pay-to-play") throw new Error("UI deployment must select bike-nft, escrow or pay-to-play")
  const expectedChainId = checkedReleaseChainId(Number(requiredEnv(env, "UI_RELEASE_EXPECTED_CHAIN_ID")))
  const sourceCommit = requiredSourceCommit(requiredEnv(env, "UI_RELEASE_SOURCE_COMMIT"))
  const artifact = await readBoundedRegularFile(requiredEnv(env, "UI_RELEASE_CONTRACT_ARTIFACT_PATH"), "backing deployment artifact", 1024 * 1024)
  const backing = backingFromDeployment(app, artifact)
  if (backing.chainId !== expectedChainId) throw new Error("Cannot prepare UI deployment: the backing artifact belongs to a different chain")
  const client = createPublicClient({ transport: http(requiredEnv(env, "UI_RELEASE_RPC_URL")) })
  const observed = await verifyUIBacking(client, backing)
  const plan = parseUIReleasePlan(new TextEncoder().encode(JSON.stringify({
    schema: "cam.ui-release-plan.v1", app, sourceCommit, expectedChainId,
    backing: { ...backing, creationInputHash: observed.creationInputHash },
  })))
  const planPath = requiredEnv(env, "UI_RELEASE_PLAN_PATH")
  await writeNewJson(planPath, plan, "UI release plan")
  process.stdout.write(`${JSON.stringify({ event: "ui_release_plan", app, sourceCommit, expectedChainId,
    backing: backing.address, backingCreator: backing.creator, backingSourceCommit: backing.sourceCommit,
    backingObservation: { blockNumber: observed.blockNumber, blockHash: observed.blockHash }, planPath })}\n`)
}

runReleaseTool(main)
