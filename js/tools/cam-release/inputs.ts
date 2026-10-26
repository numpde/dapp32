import { rootFromArtifact } from "./publication.ts"
import { requiredEnv } from "../input.ts"
import { businessFromDeployment } from "../contract-release/shared.ts"
import { parseUIDeploymentArtifact } from "../ui-release/shared.ts"
import { readBoundedRegularFile, writeNewBytes } from "../release-files.ts"
import { requiredSourceCommit, runReleaseTool } from "../release-values.ts"

async function main(): Promise<void> {
  const env = process.env
  const app = requiredEnv(env, "CAM_RELEASE_APP")
  if (app !== "bike-nft" && app !== "escrow" && app !== "pay-to-play") throw new Error("CAM inputs must select bike-nft, escrow or pay-to-play")
  const sourceCommit = requiredSourceCommit(requiredEnv(env, "CAM_RELEASE_SOURCE_COMMIT"))
  const businessBytes = await readBoundedRegularFile("/selected/business.json", "selected business artifact", 1024 * 1024)
  const uiBytes = await readBoundedRegularFile("/selected/ui.json", "selected UI artifact", 1024 * 1024)
  const business = businessFromDeployment(app, businessBytes)
  const ui = parseUIDeploymentArtifact(uiBytes, app)
  const rootMode = requiredEnv(env, "CAM_RELEASE_ROOT")
  let rootSourceCommit = sourceCommit
  let rootBytes: Uint8Array | undefined
  if (rootMode === "existing") {
    rootBytes = await readBoundedRegularFile("/selected/root.json", "selected root origin", 1024 * 1024)
    rootSourceCommit = rootFromArtifact(app, rootBytes).sourceCommit
  } else if (rootMode !== "new") throw new Error("CAM root selection must explicitly choose new or existing")
  // This phase selects immutable source archives; chain and program admission follow compilation.
  const sources = { CAM_BUSINESS_SOURCE_COMMIT: business.sourceCommit, CAM_UI_SOURCE_COMMIT: ui.sourceCommit,
    CAM_ROOT_SOURCE_COMMIT: rootSourceCommit, CAM_AUTHORING_SOURCE_COMMIT: sourceCommit }
  await writeNewBytes("/inputs/business.json", businessBytes, "selected business input")
  await writeNewBytes("/inputs/ui.json", uiBytes, "selected UI input")
  if (rootBytes !== undefined) await writeNewBytes("/inputs/root.json", rootBytes, "selected root input")
  await writeNewBytes("/inputs/sources", new TextEncoder().encode(Object.entries(sources).map(([name, value]) => `${name}=${value}\0`).join("")), "selected component sources")
}

runReleaseTool(main)
