import type { ContractIdentityReference } from "./release-provenance.ts"
import { ARTIFACTS, type ReleaseApp } from "./release-approval/reference-read.ts"
import { businessFromDeployment } from "./contract-release/shared.ts"
import { parseUIDeploymentArtifact } from "./ui-release/shared.ts"
import { rootFromArtifact } from "./cam-release/publication.ts"
import { checkedReleaseChainId, parseJsonRecord, requiredNonzeroAddress, requiredNonzeroBytes32,
  requiredSafeInteger, requiredTransactionHash } from "./release-values.ts"

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
      // Historical full deployments used the same source revision for their UI and business contracts.
      const uiField = app === "escrow" ? "camEscrowUI" : app === "pay-to-play" ? "payToPlayUI" : "ui"
      if (artifact.schema !== "pay-to-play.deployment.v1") selected.push({ role: "ui", sourceCommit: business.sourceCommit,
        chainId: checkedReleaseChainId(requiredSafeInteger(artifact.chainId, "deployment chain ID")), identity: {
          address: requiredNonzeroAddress(artifact[uiField], "deployed UI"),
          creationTransaction: requiredTransactionHash(artifact[`${uiField}CreationTransaction`], "UI creation transaction"),
          codeHash: requiredNonzeroBytes32(artifact[`${uiField}CodeHash`], "UI runtime hash"),
        } })
    }
  }
  return selected.map(contract => ({ ...contract, location: ARTIFACTS[app][contract.role]! }))
}
