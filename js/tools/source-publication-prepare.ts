import { resolve } from "node:path"
import { access } from "node:fs/promises"
import { requiredEnv } from "./input.ts"
import { readBoundedRegularFile, writeNewBytes, writeNewJson } from "./release-files.ts"
import { readSourceVerificationInput } from "./release-compiled-contract.ts"
import { runReleaseTool } from "./release-values.ts"
import { sourcePublicationContracts } from "./source-publication.ts"

async function main() {
  const app = requiredEnv(process.env, "SOURCE_PUBLICATION_APP")
  if (app !== "bike-nft" && app !== "escrow" && app !== "pay-to-play") throw new Error("Source publication requires a maintained app")
  const contracts = sourcePublicationContracts(app, await readBoundedRegularFile("/selected/deployment.json", "selected deployment", 1024 * 1024))
  if (process.argv[2] === "select") {
    await writeNewJson("/requests/contracts.json", contracts, "source publication selection")
    await writeNewBytes("/requests/source-commits", new TextEncoder().encode([...new Set(contracts.map(contract => contract.sourceCommit))].join("\n") + "\n"), "original source commits")
    return
  }
  // Prepare every request before any external submission, so a missing original source fails locally.
  for (const contract of contracts) {
    let artifacts = "/records/approval-artifacts"
    if (contract.role === "camRoot") {
      try { await access("/records/root-proof/compiler/root/CamRoot.sol/CamRoot.json"); artifacts = "/records/root-proof/compiler/root" }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error }
    }
    const { metadata, ...input } = await readSourceVerificationInput(contract.location, artifacts, resolve("/sources", contract.sourceCommit, "dapps"))
    await writeNewJson(`/requests/${contract.role}.json`, { ...contract, metadata, body: {
      ...input, creationTransactionHash: contract.identity.creationTransaction.toLowerCase(),
    } }, "public source request")
  }
}

runReleaseTool(main)
