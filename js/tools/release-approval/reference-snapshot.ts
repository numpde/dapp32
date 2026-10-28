import { readCompiledContractSource } from "../release-compiled-contract.ts"

import { parseUIReleasePlan, uiDeploymentReference, type UIDeploymentReference } from "../ui-release/shared.ts"
import { parseContractReleasePlan } from "../contract-release/shared.ts"
import { contractDeploymentReference } from "../contract-release/reference.ts"
import { parseJsonRecord } from "../release-values.ts"
import { writeNewJson } from "../release-files.ts"
import type { ReleaseReference, ExpectedStep } from "./reference.ts"
import {
  ARTIFACTS, businessContractRoles, COMPILER_VERSION, assertAbiMatchesSteps, record, sha256,
  type ReleaseApp, type CompiledContractReference, type ReferenceSnapshot,
} from "./reference-read.ts"
export { parseReferenceSnapshot } from "./reference-read.ts"
export type { ReleaseApp, CompiledContractReference, ReferenceSnapshot } from "./reference-read.ts"

export async function readFreshCompiledContract(
  app: ReleaseApp,
  step: ExpectedStep,
  steps: readonly ExpectedStep[],
  artifactsRoot: string,
  sourcesRoot: string,
): Promise<CompiledContractReference> {
  const location = ARTIFACTS[app][step.role]
  if (!location || location.contract !== step.name) throw new Error(`no compiler artifact declared for ${app} ${step.role}:${step.name}`)
  const compiled = await readCompiledContractSource(location, artifactsRoot, sourcesRoot)
  if (compiled.compilerVersion !== COMPILER_VERSION) throw new Error(`${step.name} compiler version differs from pinned ${COMPILER_VERSION}`)
  const optimizer = record(compiled.compilerSettings.optimizer, `${step.name} optimizer`)
  if (optimizer.enabled !== true || optimizer.runs !== 200 || compiled.compilerSettings.evmVersion !== "prague") {
    throw new Error(`${step.name} compiler settings differ from pinned release build`)
  }
  assertAbiMatchesSteps(step.role, compiled.abi, steps)
  const { compilerSettings: _settings, ...source } = compiled
  return { role: step.role, ...source }
}

export function releaseReferenceFromPlan(app: ReleaseApp, planBytes: Uint8Array, deployer: string): ReleaseReference | UIDeploymentReference {
  const schema = parseJsonRecord(planBytes, "release plan").schema
  if (schema === "cam.ui-release-plan.v1") {
    const plan = parseUIReleasePlan(planBytes)
    if (plan.app !== app) throw new Error("UI release plan names a different app")
    return uiDeploymentReference(plan, deployer)
  }
  if (schema === "cam.contract-release-plan.v1") {
    const plan = parseContractReleasePlan(planBytes)
    if (plan.app !== app) throw new Error("Business release plan names a different app")
    return contractDeploymentReference(plan, deployer)
  }
  throw new Error("Release approval requires an independent business or UI release plan")
}

export async function prepareReferenceSnapshot(
  app: ReleaseApp,
  expected: ReleaseReference,
  planBytes: Uint8Array,
  artifactsRoot: string,
  sourcesRoot: string,
): Promise<ReferenceSnapshot> {
  if (planBytes.byteLength > 64 * 1024) throw new Error("release plan exceeds 65536 bytes")
  const fromPlan = releaseReferenceFromPlan(app, planBytes, expected.expectedDeployer)
  if (JSON.stringify(fromPlan) !== JSON.stringify(expected)) throw new Error("reference steps or identity differ from the validated release plan")
  const creates = expected.steps.filter((step) => step.kind === "create")
  const uiOnly = "backing" in fromPlan
  if (creates.length !== (uiOnly ? 1 : businessContractRoles(app).length)) throw new Error(`${app} reference has an incomplete creation inventory`)
  const contracts: CompiledContractReference[] = []
  for (const step of creates) contracts.push(await readFreshCompiledContract(app, step, expected.steps, artifactsRoot, sourcesRoot))
  // The launcher must bind the mounted source archive to this plan's commit.
  const identity = {
    app, sourceCommit: expected.sourceCommit, expectedChainId: expected.expectedChainId,
    expectedDeployer: expected.expectedDeployer, planSha256: sha256(planBytes),
    steps: expected.steps, contracts,
  }
  const base = uiOnly
    ? { schema: "release-approval.ui-reference.v1" as const, ...identity, backing: fromPlan.backing }
    : { schema: "release-approval.contract-reference.v1" as const, ...identity }
  return { ...base, snapshotSha256: sha256(JSON.stringify(base)) }
}

export async function writeReferenceSnapshot(path: string, snapshot: ReferenceSnapshot): Promise<void> {
  await writeNewJson(path, snapshot, "release approval reference")
}
