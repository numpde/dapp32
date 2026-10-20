import type { ReleaseReference } from "../release-approval/reference.ts"
import { createdContract, expectedDeployer } from "../release-approval/reference.ts"
import { parseReleasePlan } from "./shared.ts"

export function escrowReference(planBytes: Uint8Array, independentDeployer: string): ReleaseReference {
  const plan = parseReleasePlan(planBytes)
  const deployer = expectedDeployer(independentDeployer)
  const steps: ReleaseReference["steps"][number][] = [
    { kind: "create", role: "camRoot", name: "CamRoot", constructorTypes: ["address", "string", "bytes32"], args: [deployer, plan.camURI, plan.camHash] },
    { kind: "create", role: "escrow", name: "CamEscrow", constructorTypes: [], args: [] },
    { kind: "create", role: "ui", name: "CamEscrowUI", constructorTypes: ["address"], args: [createdContract("escrow")] },
    { kind: "call", role: "camRoot", name: "setContractAddress", signature: "setContractAddress(string,address)", args: ["CamEscrowUI", createdContract("ui")] },
    { kind: "call", role: "camRoot", name: "setContractAddress", signature: "setContractAddress(string,address)", args: ["CamEscrow", createdContract("escrow")] },
  ]
  if (plan.intendedCamRootOwner.toLowerCase() !== deployer.toLowerCase()) {
    steps.push({ kind: "call", role: "camRoot", name: "transferOwnership", signature: "transferOwnership(address)", args: [plan.intendedCamRootOwner] })
  }
  return { sourceCommit: plan.sourceCommit, expectedChainId: plan.expectedChainId, expectedDeployer: deployer, steps }
}
