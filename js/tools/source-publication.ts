import type { ContractIdentityReference } from "./release-provenance.ts"
import { ARTIFACTS, type ReleaseApp } from "./release-approval/reference-read.ts"
import { businessFromDeployment } from "./contract-release/shared.ts"
import { parseUIDeploymentArtifact, uiFromLegacyDeployment } from "./ui-release/shared.ts"
import { rootFromArtifact } from "./cam-release/publication.ts"
import { parseJsonRecord } from "./release-values.ts"

/** Select deployed identities, not current bindings or the current checkout's contract versions. */
export function sourcePublicationContracts(app: ReleaseApp, bytes: Uint8Array) {
  const artifact = parseJsonRecord(bytes, "source publication deployment")
  const selected: { role: string; sourceCommit: string; chainId: number; identity: ContractIdentityReference }[] = []
  if (artifact.schema === "cam.ui-deployment.v1") {
    const ui = parseUIDeploymentArtifact(bytes, app)
    selected.push({ role: "ui", sourceCommit: ui.sourceCommit, chainId: ui.chainId, identity: ui.ui })
  } else if (artifact.schema === "cam.publication.v1") {
    const root = rootFromArtifact(app, bytes)
    selected.push({ role: "camRoot", sourceCommit: root.sourceCommit, chainId: root.chainId, identity: root.contract })
  } else {
    const business = businessFromDeployment(app, bytes)
    for (const [role, identity] of Object.entries(business.contracts)) {
      selected.push({ role, sourceCommit: business.sourceCommit, chainId: business.chainId, identity })
    }
    if (artifact.schema !== "cam.contract-deployment.v1") {
      const root = rootFromArtifact(app, bytes)
      selected.push({ role: "camRoot", sourceCommit: root.sourceCommit, chainId: root.chainId, identity: root.contract })
      const ui = uiFromLegacyDeployment(app, bytes)
      if (ui !== undefined) selected.push({ role: "ui", ...ui })
    }
  }
  return selected.map(contract => ({ ...contract, location: ARTIFACTS[app][contract.role]! }))
}

export function sourcePublicationCatalog(app: ReleaseApp, records: readonly { path: string; artifact: unknown }[], selectedPath: string | null) {
  const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value))
  const selected = selectedPath === null ? undefined : records.find(record => record.path === selectedPath)
  if (selectedPath !== null && selected === undefined) throw new Error("Selected CAM publication is missing from the source inventory")
  const selectedKeys = new Set<string>()
  const key = (chainId: number, address: string) => `${chainId}-${address.toLowerCase()}`
  if (selected !== undefined) {
    const bytes = encode(selected.artifact)
    const root = rootFromArtifact(app, bytes)
    selectedKeys.add(key(root.chainId, root.contract.address))
    if (root.kind === "legacy-origin") {
      for (const contract of sourcePublicationContracts(app, bytes)) selectedKeys.add(key(contract.chainId, contract.identity.address))
    } else {
      for (const address of Object.values(root.bindings)) selectedKeys.add(key(root.chainId, address))
    }
  }
  const contracts = new Map<string, ReturnType<typeof sourcePublicationContracts>[number] & { key: string; artifactPath: string; selected: boolean }>()
  for (const record of records) {
    for (const contract of sourcePublicationContracts(app, encode(record.artifact))) {
      const id = key(contract.chainId, contract.identity.address)
      const previous = contracts.get(id)
      if (previous !== undefined) {
        if (previous.sourceCommit !== contract.sourceCommit || previous.location.contract !== contract.location.contract
          || previous.identity.codeHash.toLowerCase() !== contract.identity.codeHash.toLowerCase()
          || previous.identity.creationTransaction.toLowerCase() !== contract.identity.creationTransaction.toLowerCase()
          || (previous.identity.creationInputHash !== undefined && contract.identity.creationInputHash !== undefined
            && previous.identity.creationInputHash.toLowerCase() !== contract.identity.creationInputHash.toLowerCase())) {
          throw new Error(`Saved records disagree about source provenance for ${id}`)
        }
        continue
      }
      contracts.set(id, { ...contract, key: id, artifactPath: record.path, selected: selectedKeys.has(id) })
    }
  }
  for (const id of selectedKeys) if (!contracts.has(id)) throw new Error(`Selected deployment has no source records for ${id}`)
  return { hasSelectedDeployment: selected !== undefined,
    contracts: [...contracts.values()].sort((a, b) => Number(b.selected) - Number(a.selected) || a.location.contract.localeCompare(b.location.contract) || a.key.localeCompare(b.key)) }
}
