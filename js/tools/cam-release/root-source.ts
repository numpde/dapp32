import { requiredEnv } from "../input.ts"
import { readBoundedRegularFile, writeNewBytes } from "../release-files.ts"
import { runReleaseTool } from "../release-values.ts"
import { rootFromArtifact } from "./publication.ts"
import { retainCompilationSources } from "./retain-sources.ts"

async function main(): Promise<void> {
  const app = requiredEnv(process.env, "CAM_RELEASE_APP")
  if (app !== "bike-nft" && app !== "escrow" && app !== "pay-to-play") throw new Error("Original root proof must select a supported app")
  const phase = requiredEnv(process.env, "CAM_ROOT_SOURCE_PHASE")
  if (phase === "retain") {
    await retainCompilationSources("/root-proof/compiler/root", "/root-proof/sources/root")
    return
  }
  if (phase !== "select") throw new Error("Original root source phase must be select or retain")
  const bytes = await readBoundedRegularFile("/selected/root.json", "selected original root evidence", 1024 * 1024)
  const root = rootFromArtifact(app, bytes)
  await writeNewBytes("/root-proof/root.json", bytes, "selected original root evidence")
  await writeNewBytes("/root-proof/source-commit", new TextEncoder().encode(root.sourceCommit), "original root source selection")
}

runReleaseTool(main)
