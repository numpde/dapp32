import type { ReleaseReference } from "../release-approval/reference.ts"
import { createdContract, expectedDeployer } from "../release-approval/reference.ts"
import { parseReleasePlan } from "./shared.ts"

export function escrowReference(planBytes: Uint8Array, independentDeployer: string): ReleaseReference {
  const plan = parseReleasePlan(planBytes)
  const deployer = expectedDeployer(independentDeployer)
  const steps: ReleaseReference["steps"][number][] = [
    { kind: "create", role: "camRoot", name: "CamRoot", action: "Deploy CAM root with the selected manifest", argumentLabels: ["Initial CAM owner", "CAM manifest URI", "CAM manifest SHA-256"], constructorTypes: ["address", "string", "bytes32"], args: [deployer, plan.camURI, plan.camHash] },
    { kind: "create", role: "escrow", name: "CamEscrow", action: "Deploy agreement escrow contract", argumentLabels: [], constructorTypes: [], args: [] },
    { kind: "create", role: "ui", name: "CamEscrowUI", action: "Deploy escrow workflow interface", argumentLabels: ["Verified CamEscrow contract"], constructorTypes: ["address"], args: [createdContract("escrow")] },
    { kind: "call", role: "camRoot", name: "setContractAddress", action: "Bind the escrow workflow interface in CAM", argumentLabels: ["CAM contract name", "Verified CamEscrowUI contract"], signature: "setContractAddress(string,address)", args: ["CamEscrowUI", createdContract("ui")] },
    { kind: "call", role: "camRoot", name: "setContractAddress", action: "Bind the escrow contract in CAM", argumentLabels: ["CAM contract name", "Verified CamEscrow contract"], signature: "setContractAddress(string,address)", args: ["CamEscrow", createdContract("escrow")] },
  ]
  if (plan.intendedCamRootOwner.toLowerCase() !== deployer.toLowerCase()) {
    steps.push({ kind: "call", role: "camRoot", name: "transferOwnership", action: "Nominate the selected CAM owner; separate acceptance is required", argumentLabels: ["Selected CAM owner"], signature: "transferOwnership(address)", args: [plan.intendedCamRootOwner] })
  }
  return { sourceCommit: plan.sourceCommit, expectedChainId: plan.expectedChainId, expectedDeployer: deployer, steps }
}
