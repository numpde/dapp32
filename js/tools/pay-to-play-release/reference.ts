import type { ReleaseReference } from "../release-approval/reference.ts"
import { createdContract, expectedDeployer } from "../release-approval/reference.ts"
import { parseReleasePlan } from "./shared.ts"

export function payToPlayReference(planBytes: Uint8Array, independentDeployer: string): ReleaseReference {
  const plan = parseReleasePlan(planBytes)
  const deployer = expectedDeployer(independentDeployer)
  const steps: ReleaseReference["steps"][number][] = [
    { kind: "create", role: "camRoot", name: "CamRoot", constructorTypes: ["address", "string", "bytes32"], args: [deployer, plan.camURI, plan.camHash] },
    { kind: "create", role: "payments", name: "PayToPlay", constructorTypes: ["address", "uint64"], args: [deployer, String(plan.nullClaimPeriod)] },
    { kind: "call", role: "camRoot", name: "setContractAddress", signature: "setContractAddress(string,address)", args: ["PayToPlay", createdContract("payments")] },
  ]
  if (plan.intendedCamRootOwner.toLowerCase() !== deployer.toLowerCase()) {
    steps.push({ kind: "call", role: "camRoot", name: "transferOwnership", signature: "transferOwnership(address)", args: [plan.intendedCamRootOwner] })
  }
  if (plan.intendedPaymentAdmin.toLowerCase() !== deployer.toLowerCase()) {
    steps.push({ kind: "call", role: "payments", name: "transferOwnership", signature: "transferOwnership(address)", args: [plan.intendedPaymentAdmin] })
  }
  return { sourceCommit: plan.sourceCommit, expectedChainId: plan.expectedChainId, expectedDeployer: deployer, steps }
}
