import { requiredEnv } from "../input.ts"
import { readBoundedRegularFile, writeNewBytes } from "../release-files.ts"
import { runReleaseTool } from "../release-values.ts"
import { rootFromArtifact } from "./publication.ts"

async function main(): Promise<void> {
  const app = requiredEnv(process.env, "CAM_RELEASE_APP")
  if (app !== "bike-nft" && app !== "escrow" && app !== "pay-to-play") throw new Error("Original root proof must select a supported app")
  const bytes = await readBoundedRegularFile("/selected/root.json", "selected original root evidence", 1024 * 1024)
  const root = rootFromArtifact(app, bytes)
  await writeNewBytes("/root-proof/root.json", bytes, "selected original root evidence")
  await writeNewBytes("/root-proof/source-commit", new TextEncoder().encode(root.sourceCommit), "original root source selection")
}

runReleaseTool(main)
