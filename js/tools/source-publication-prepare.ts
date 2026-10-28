import { resolve } from "node:path"
import { access } from "node:fs/promises"
import { requiredEnv } from "./input.ts"
import { readBoundedRegularFile, writeNewBytes, writeNewJson } from "./release-files.ts"
import { readSourceVerificationInput } from "./release-compiled-contract.ts"
import { runReleaseTool } from "./release-values.ts"
import { sourcePublicationContracts, sourcePublicationCatalog } from "./source-publication.ts"

async function main() {
  const app = requiredEnv(process.env, "SOURCE_PUBLICATION_APP")
  if (app !== "bike-nft" && app !== "escrow" && app !== "pay-to-play") throw new Error("Source publication requires a maintained app")
  if (process.argv[2] === "catalog") {
    const inventory = JSON.parse(new TextDecoder().decode(await readBoundedRegularFile("/selected/deployment.json", "instance source inventory", 8 * 1024 * 1024)))
    const catalog = sourcePublicationCatalog(app, inventory.records, inventory.selectedPublication)
    const networks = Object.values(JSON.parse(new TextDecoder().decode(await readBoundedRegularFile("packages/cam-viewer/src/rpc-catalog.json", "RPC catalog", 1024 * 1024)))) as { chainId: number; name: string; explorer?: string }[]
    const contracts = catalog.contracts.map(contract => {
      const network = networks.find(network => network.chainId === contract.chainId)
      return { ...contract, network: network === undefined ? undefined : { name: network.name, explorer: network.explorer } }
    })
    await writeNewJson("/requests/catalog.json", { ...catalog, contracts }, "contract source menu")
    return
  }
  if (process.argv[2] === "selection") {
    const catalog = JSON.parse(new TextDecoder().decode(await readBoundedRegularFile("/requests/catalog.json", "contract source menu", 1024 * 1024))) as ReturnType<typeof sourcePublicationCatalog>
    const keys = new TextDecoder().decode(await readBoundedRegularFile("/requests/selected-keys", "selected contracts", 64 * 1024)).split("\0").filter(Boolean)
    const selected = keys.map(key => {
      const contract = catalog.contracts.find(contract => contract.key === key)
      if (contract === undefined) throw new Error(`Selected contract is outside this instance catalog: ${key}`)
      return contract
    })
    await writeNewJson("/requests/contracts.json", selected, "selected source contracts")
    const groups = new Map<string, string[]>()
    for (const contract of selected) {
      const roles = groups.get(contract.artifactPath)
      if (roles === undefined) groups.set(contract.artifactPath, [contract.role])
      else roles.push(contract.role)
    }
    await writeNewBytes("/requests/source-records", new TextEncoder().encode([...groups].map(([path, roles]) => `${path}\0${roles.join(" ")}\0`).join("")), "selected source records")
    await writeNewBytes("/requests/request-links", new TextEncoder().encode(selected.map(contract => `${contract.artifactPath}\0${contract.role}\0${contract.key}\0`).join("")), "selected source request links")
    return
  }
  const all = sourcePublicationContracts(app, await readBoundedRegularFile("/selected/deployment.json", "selected deployment", 1024 * 1024))
  const roles = process.argv.slice(process.argv[2] === "select" ? 3 : 2)
  for (const role of roles) if (!all.some(contract => contract.role === role)) throw new Error(`Unknown source publication role: ${role}`)
  const contracts = roles.length === 0 ? all : all.filter(contract => roles.includes(contract.role))
  if (process.argv[2] === "select") {
    await writeNewJson("/requests/contracts.json", contracts, "source publication selection")
    await writeNewBytes("/requests/source-commits", new TextEncoder().encode([...new Set(contracts.map(contract => contract.sourceCommit))].join("\n") + "\n"), "original source commits")
    await writeNewBytes("/requests/source-roles", new TextEncoder().encode(contracts.map(contract => `${contract.role}\0`).join("")), "selected source roles")
    await writeNewBytes("/requests/source-state-keys", new TextEncoder().encode(contracts.map(contract => `${contract.role}\0${contract.chainId}-${contract.identity.address.toLowerCase()}\0`).join("")), "source job identities")
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
