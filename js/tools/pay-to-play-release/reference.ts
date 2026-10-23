import type { ReleaseReference } from "../release-approval/reference.ts"
import { createdContract, expectedDeployer } from "../release-approval/reference.ts"
import { parseReleasePlan } from "./shared.ts"

export function payToPlayReference(planBytes: Uint8Array, independentDeployer: string): ReleaseReference {
  const plan = parseReleasePlan(planBytes)
  const deployer = expectedDeployer(independentDeployer)
  const steps: ReleaseReference["steps"][number][] = [
    { kind: "create", role: "camRoot", name: "CamRoot", action: "Deploy CAM root with the selected manifest", argumentLabels: ["Initial CAM owner", "CAM manifest URI", "CAM manifest SHA-256"], constructorTypes: ["address", "string", "bytes32"], args: [deployer, plan.camURI, plan.camHash] },
    { kind: "create", role: "payments", name: "PayToPlay", action: "Deploy payment contract with the reserved-channel withdrawal wait", argumentLabels: ["Initial payment admin", "Reserved-channel withdrawal wait (seconds)"], constructorTypes: ["address", "uint64"], args: [deployer, String(plan.nullClaimPeriod)] },
    { kind: "call", role: "camRoot", name: "setContractAddress", action: "Bind the payment contract in CAM", argumentLabels: ["CAM contract name", "Verified PayToPlay contract"], signature: "setContractAddress(string,address)", args: ["PayToPlay", createdContract("payments")] },
  ]
  if (plan.intendedCamRootOwner.toLowerCase() !== deployer.toLowerCase()) {
    steps.push({ kind: "call", role: "camRoot", name: "transferOwnership", action: "Nominate the selected CAM owner; separate acceptance is required", argumentLabels: ["Selected CAM owner"], signature: "transferOwnership(address)", args: [plan.intendedCamRootOwner] })
  }
  if (plan.intendedPaymentAdmin.toLowerCase() !== deployer.toLowerCase()) {
    steps.push({ kind: "call", role: "payments", name: "transferOwnership", action: "Nominate the selected payment admin; separate acceptance is required", argumentLabels: ["Selected payment admin"], signature: "transferOwnership(address)", args: [plan.intendedPaymentAdmin] })
  }
  return { sourceCommit: plan.sourceCommit, expectedChainId: plan.expectedChainId, expectedDeployer: deployer, steps }
}
