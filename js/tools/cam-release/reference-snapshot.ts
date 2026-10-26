import type { CompiledContractSource } from "../release-compiled-contract.ts"
import { ARTIFACTS, sha256, type CompiledContractReference, type ReferenceSnapshot } from "../release-approval/reference-read.ts"
import { readFreshCompiledContract } from "../release-approval/reference-snapshot.ts"
import type { AdmittedCamComponents } from "./components.ts"
import { camPublicationReference } from "./reference.ts"
import { parseCamReleasePlan, type ExistingCamRoot } from "./shared.ts"

/** Fresh admission and snapshot creation share the same in-memory component facts. */
export async function prepareCamReferenceSnapshot({ planBytes, components, signer, admittedRoot, originalRootCompilation, artifactsRoot, sourcesRoot }: {
  readonly planBytes: Uint8Array
  readonly components: AdmittedCamComponents
  readonly signer: string
  readonly admittedRoot?: ExistingCamRoot
  readonly originalRootCompilation?: CompiledContractSource
  readonly artifactsRoot: string
  readonly sourcesRoot: string
}): Promise<ReferenceSnapshot> {
  const plan = parseCamReleasePlan(planBytes)
  if (components.observationBlock.number !== BigInt(plan.observationBlock.number)
      || components.observationBlock.hash.toLowerCase() !== plan.observationBlock.hash.toLowerCase()) {
    throw new Error("Cannot prepare CAM approval: its fresh component/root observation differs from the retained plan anchor")
  }
  if (plan.root.kind === "existing") {
    if (admittedRoot === undefined) throw new Error("Cannot prepare CAM approval: existing root admission is required")
    const selected = plan.root
    const facts: readonly (readonly [string, string, string | undefined])[] = [
      ...(["address", "codeHash", "creationTransaction", "creationInputHash"] as const)
        .map(key => [key, selected.contract[key], admittedRoot.contract[key]] as const),
      ["sourceCommit", selected.sourceCommit, admittedRoot.sourceCommit],
      ["creator", selected.creator, admittedRoot.creator], ["owner", selected.owner, admittedRoot.owner],
      ["pendingOwner", selected.pendingOwner, admittedRoot.pendingOwner],
      ["origin kind", selected.origin.kind, admittedRoot.origin.kind],
      ["origin artifact SHA-256", selected.origin.artifactSha256, admittedRoot.origin.artifactSha256],
      ["manifest hash", selected.manifest.hash, admittedRoot.manifest.hash],
      ...Object.entries(selected.bindings).map(([name, target]) => [`binding ${name}`, target, admittedRoot.bindings[name]] as const),
    ]
    let mismatch = facts.find(([, planned, observed]) => observed === undefined || planned.toLowerCase() !== observed.toLowerCase())
    if (mismatch === undefined && selected.manifest.uri !== admittedRoot.manifest.uri) {
      mismatch = ["manifest URI", selected.manifest.uri, admittedRoot.manifest.uri]
    }
    if (mismatch !== undefined) {
      throw new Error(`Cannot prepare CAM approval: root ${selected.contract.address} ${mismatch[0]} ${JSON.stringify(mismatch[1])} differs from the admitted root ${admittedRoot.contract.address} value ${JSON.stringify(mismatch[2])}`)
    }
  }
  const expected = camPublicationReference(plan, signer, components, originalRootCompilation?.abi)
  let compiled: CompiledContractReference
  if (plan.root.kind === "new") {
    compiled = await readFreshCompiledContract(plan.app, expected.steps[0]!, expected.steps, artifactsRoot, sourcesRoot)
  } else {
    if (originalRootCompilation === undefined) throw new Error("Cannot prepare CAM approval: original root compilation is required")
    const location = ARTIFACTS[plan.app].camRoot!
    if (originalRootCompilation.name !== location.contract || originalRootCompilation.source !== location.source) {
      throw new Error("Cannot prepare CAM approval: original compiler artifact does not describe CamRoot")
    }
    const { compilerSettings: _settings, ...source } = originalRootCompilation
    compiled = { role: "camRoot", ...source }
  }
  const root = plan.root.kind === "new" ? { kind: "new" as const }
    : { kind: "existing" as const, sourceCommit: plan.root.sourceCommit, creator: plan.root.creator, contract: plan.root.contract }
  const base = { schema: "release-approval.cam-reference.v1" as const, app: plan.app,
    sourceCommit: expected.sourceCommit, expectedChainId: expected.expectedChainId, expectedDeployer: expected.expectedDeployer,
    planSha256: sha256(planBytes), steps: expected.steps, contracts: [compiled], root }
  return { ...base, snapshotSha256: sha256(JSON.stringify(base)) }
}
