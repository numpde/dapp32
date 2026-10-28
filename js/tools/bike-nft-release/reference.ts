import { keccak256, stringToHex, type Address } from "viem"
import type { ExpectedArgument, ExpectedStep } from "../release-approval/reference.ts"
import { createdContract } from "../release-approval/reference.ts"
import type { ContractSettings } from "./shared.ts"

const roleId = (name: string) => keccak256(stringToHex(name))

export function bikeUICreation(manager: ExpectedArgument): ExpectedStep {
  return { kind: "create", role: "ui", name: "BicycleComponentManagerUI", action: "Deploy Bike workflow interface", argumentLabels: ["Verified BicycleComponentManager contract"], constructorTypes: ["address"], args: [manager] }
}

export function bikeUIBinding(ui: ExpectedArgument): ExpectedStep {
  return { kind: "call", role: "camRoot", name: "setContractAddress", action: "Bind the Bike workflow interface in CAM", argumentLabels: ["CAM contract name", "Verified BicycleComponentManagerUI contract"], signature: "setContractAddress(string,address)", args: ["BicycleComponentManagerUI", ui] }
}

export function bikeContractCreations(plan: ContractSettings, deployer: Address): ExpectedStep[] {
  return [
    { kind: "create", role: "components", name: "BicycleComponents", action: "Deploy component NFT collection and initial admin-transfer delay", argumentLabels: ["Collection name", "Collection symbol", "Initial Components admin", "Components admin-transfer delay (seconds)", "Token metadata URI prefix", "Collection metadata URI"], constructorTypes: ["string", "string", "address", "uint48", "string", "string"], args: [plan.tokenName, plan.tokenSymbol, deployer, String(plan.componentsAdminDelay), plan.baseTokenURI, plan.collectionURI] },
    { kind: "create", role: "manager", name: "BicycleComponentManager", action: "Deploy component registration manager and initial admin-transfer delay", argumentLabels: ["Initial Manager admin", "Manager admin-transfer delay (seconds)", "Verified BicycleComponents contract"], constructorTypes: ["address", "uint48", "address"], args: [deployer, String(plan.managerAdminDelay), createdContract("components")] },
  ]
}

export function bikeContractConfiguration(plan: ContractSettings, deployer: Address): ExpectedStep[] {
  const sender = deployer.toLowerCase()
  const steps: ExpectedStep[] = []
  const call = (role: string, name: string, signature: string, action: string, argumentLabels: readonly string[], ...args: ExpectedStep["args"]): void => {
    steps.push({ kind: "call", role, name, action, argumentLabels, signature, args })
  }
  const grant = (role: string, roleName: string, account: ExpectedStep["args"][number], permission: string, recipient: string): void => {
    call(role, "grantRole", "grantRole(bytes32,address)", `Grant permission on ${role} to ${permission}`,
      [`${roleName}: ${permission}`, recipient], roleId(roleName), account)
  }
  const revoke = (role: string, roleName: string, permission: string): void => {
    call(role, "revokeRole", "revokeRole(bytes32,address)", `Remove permission on ${role} to ${permission}`,
      [`${roleName}: ${permission}`, "Account losing permission"], roleId(roleName), deployer)
  }
  const componentsPausing = "pause and resume token operations"
  const componentsConfiguration = "change base and collection metadata settings"
  const managerPausing = "pause and resume Manager operations"
  const managerConfiguration = "change the component collection and maximum delegation duration"

  grant("components", "MINTER_ROLE", createdContract("manager"), "mint component NFTs", "Verified BicycleComponentManager contract")
  grant("components", "TOKEN_URI_SETTER_ROLE", createdContract("manager"), "update token metadata", "Verified BicycleComponentManager contract")
  grant("components", "PAUSER_ROLE", plan.componentsPauser, componentsPausing, "Selected Components pauser")
  grant("components", "CONFIGURER_ROLE", plan.componentsConfigurer, componentsConfiguration, "Selected Components configurer")
  grant("manager", "PAUSER_ROLE", plan.managerPauser, managerPausing, "Selected Manager pauser")
  grant("manager", "CONFIGURER_ROLE", plan.managerConfigurer, managerConfiguration, "Selected Manager configurer")
  for (const registrar of plan.registrars) grant("manager", "REGISTRAR_ROLE", registrar, "register components and mint their NFTs", "Selected registrar")

  if (plan.componentsPauser.toLowerCase() !== sender) revoke("components", "PAUSER_ROLE", componentsPausing)
  if (plan.componentsConfigurer.toLowerCase() !== sender) revoke("components", "CONFIGURER_ROLE", componentsConfiguration)
  if (plan.managerPauser.toLowerCase() !== sender) revoke("manager", "PAUSER_ROLE", managerPausing)
  if (plan.managerConfigurer.toLowerCase() !== sender) revoke("manager", "CONFIGURER_ROLE", managerConfiguration)

  return steps
}

export function bikeAdminNominations(plan: ContractSettings, deployer: Address): ExpectedStep[] {
  const sender = deployer.toLowerCase()
  const steps: ExpectedStep[] = []
  const call = (role: string, name: string, signature: string, action: string, argumentLabels: readonly string[], ...args: ExpectedStep["args"]): void => {
    steps.push({ kind: "call", role, name, action, argumentLabels, signature, args })
  }
  if (plan.intendedComponentsAdmin.toLowerCase() !== sender) call("components", "beginDefaultAdminTransfer", "beginDefaultAdminTransfer(address)", "Nominate the selected Components admin; acceptance follows its transfer delay", ["Selected Components admin"], plan.intendedComponentsAdmin)
  if (plan.intendedManagerAdmin.toLowerCase() !== sender) call("manager", "beginDefaultAdminTransfer", "beginDefaultAdminTransfer(address)", "Nominate the selected Manager admin; acceptance follows its transfer delay", ["Selected Manager admin"], plan.intendedManagerAdmin)
  return steps
}

export function bikeCamBindings(contracts: {
  readonly camRoot: ExpectedArgument; readonly manager: ExpectedArgument
  readonly ui: ExpectedArgument; readonly components: ExpectedArgument
}): ExpectedStep[] {
  const binding = (name: string, address: ExpectedArgument, action: string, recipient: string): ExpectedStep => ({
    kind: "call", role: "camRoot", name: "setContractAddress", signature: "setContractAddress(string,address)",
    action, argumentLabels: ["CAM contract name", recipient], args: [name, address],
  })
  return [
    binding("ICamRootOwnership", contracts.camRoot, "Bind CAM ownership acceptance to the CAM host", "Verified CamRoot contract"),
    binding("BicycleComponentManager", contracts.manager, "Bind the component registry in CAM", "Verified BicycleComponentManager contract"),
    bikeUIBinding(contracts.ui),
    binding("BicycleComponents", contracts.components, "Bind the component NFT collection in CAM", "Verified BicycleComponents contract"),
  ]
}
