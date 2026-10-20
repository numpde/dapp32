import { keccak256, stringToHex } from "viem"
import type { ReleaseReference, ExpectedStep } from "../release-approval/reference.ts"
import { createdContract, expectedDeployer } from "../release-approval/reference.ts"
import { parseReleasePlan, rejectDeployerAuthorities } from "./shared.ts"

const roleId = (name: string) => keccak256(stringToHex(name))

export function bikeReference(planBytes: Uint8Array, independentDeployer: string): ReleaseReference {
  const plan = parseReleasePlan(planBytes)
  const deployer = expectedDeployer(independentDeployer)
  rejectDeployerAuthorities({ ...plan, deployer })

  const steps: ExpectedStep[] = [
    { kind: "create", role: "camRoot", name: "CamRoot", constructorTypes: ["address", "string", "bytes32"], args: [deployer, plan.camURI, plan.camHash] },
    { kind: "create", role: "components", name: "BicycleComponents", constructorTypes: ["string", "string", "address", "uint48", "string", "string"], args: [plan.tokenName, plan.tokenSymbol, deployer, String(plan.componentsAdminDelay), plan.baseTokenURI, plan.collectionURI] },
    { kind: "create", role: "manager", name: "BicycleComponentManager", constructorTypes: ["address", "uint48", "address"], args: [deployer, String(plan.managerAdminDelay), createdContract("components")] },
    { kind: "create", role: "ui", name: "BicycleComponentManagerUI", constructorTypes: ["address"], args: [createdContract("manager")] },
  ]
  const call = (role: string, name: string, signature: string, ...args: ExpectedStep["args"]): void => {
    steps.push({ kind: "call", role, name, signature, args })
  }
  const grant = (role: string, roleName: string, account: ExpectedStep["args"][number]): void => {
    call(role, "grantRole", "grantRole(bytes32,address)", roleId(roleName), account)
  }
  const revoke = (role: string, roleName: string): void => {
    call(role, "revokeRole", "revokeRole(bytes32,address)", roleId(roleName), deployer)
  }

  grant("components", "MINTER_ROLE", createdContract("manager"))
  grant("components", "TOKEN_URI_SETTER_ROLE", createdContract("manager"))
  grant("components", "PAUSER_ROLE", plan.componentsPauser)
  grant("components", "CONFIGURER_ROLE", plan.componentsConfigurer)
  grant("manager", "PAUSER_ROLE", plan.managerPauser)
  grant("manager", "CONFIGURER_ROLE", plan.managerConfigurer)
  for (const registrar of plan.registrars) grant("manager", "REGISTRAR_ROLE", registrar)

  revoke("components", "PAUSER_ROLE")
  revoke("components", "CONFIGURER_ROLE")
  revoke("manager", "PAUSER_ROLE")
  revoke("manager", "CONFIGURER_ROLE")

  call("camRoot", "setContractAddress", "setContractAddress(string,address)", "BicycleComponentManager", createdContract("manager"))
  call("camRoot", "setContractAddress", "setContractAddress(string,address)", "BicycleComponentManagerUI", createdContract("ui"))
  call("camRoot", "transferOwnership", "transferOwnership(address)", plan.intendedCamRootOwner)
  call("components", "beginDefaultAdminTransfer", "beginDefaultAdminTransfer(address)", plan.intendedComponentsAdmin)
  call("manager", "beginDefaultAdminTransfer", "beginDefaultAdminTransfer(address)", plan.intendedManagerAdmin)

  return { sourceCommit: plan.sourceCommit, expectedChainId: plan.expectedChainId, expectedDeployer: deployer, steps }
}
