import { toFunctionSelector } from "viem"
import type { Address, Hex } from "viem"
import { DEPLOYMENT_SCHEMA, ZERO_ADDRESS } from "./shared.ts"
import type { DeploymentArtifact, ReleasePlan } from "./shared.ts"
import { createdContract } from "../release-provenance.ts"
export { creationReceiptDeployer } from "../release-provenance.ts"
export type { CreatedContract, CreationReceiptEvidence } from "../release-provenance.ts"
import type { CreatedContract } from "../release-provenance.ts"

export type DeploymentContracts = {
  readonly camRoot: CreatedContract
  readonly components: CreatedContract
  readonly manager: CreatedContract
  readonly ui: CreatedContract
}

export type DeploymentEvidence = {
  readonly chainId: number
  readonly deployer: Address
  readonly contracts: DeploymentContracts
  readonly codeHashes: {
    readonly camRoot: Hex
    readonly components: Hex
    readonly manager: Hex
    readonly ui: Hex
  }
}

export function deploymentArtifact(
  plan: ReleasePlan,
  evidence: DeploymentEvidence,
): DeploymentArtifact {
  return {
    schema: DEPLOYMENT_SCHEMA,
    sourceCommit: plan.sourceCommit,
    chainId: evidence.chainId,
    deployer: evidence.deployer,
    camURI: plan.camURI,
    camHash: plan.camHash,
    intendedCamRootOwner: plan.intendedCamRootOwner,
    tokenName: plan.tokenName,
    tokenSymbol: plan.tokenSymbol,
    baseTokenURI: plan.baseTokenURI,
    collectionURI: plan.collectionURI,
    intendedComponentsAdmin: plan.intendedComponentsAdmin,
    componentsAdminDelay: plan.componentsAdminDelay,
    componentsPauser: plan.componentsPauser,
    componentsConfigurer: plan.componentsConfigurer,
    intendedManagerAdmin: plan.intendedManagerAdmin,
    managerAdminDelay: plan.managerAdminDelay,
    managerPauser: plan.managerPauser,
    managerConfigurer: plan.managerConfigurer,
    registrars: plan.registrars,
    camRoot: evidence.contracts.camRoot.address,
    components: evidence.contracts.components.address,
    manager: evidence.contracts.manager.address,
    ui: evidence.contracts.ui.address,
    camRootCodeHash: evidence.codeHashes.camRoot,
    componentsCodeHash: evidence.codeHashes.components,
    managerCodeHash: evidence.codeHashes.manager,
    uiCodeHash: evidence.codeHashes.ui,
    camRootCreationTransaction: evidence.contracts.camRoot.transactionHash,
    componentsCreationTransaction: evidence.contracts.components.transactionHash,
    managerCreationTransaction: evidence.contracts.manager.transactionHash,
    uiCreationTransaction: evidence.contracts.ui.transactionHash,
  }
}

export function deploymentContractsFromBroadcast(broadcast: unknown): DeploymentContracts {
  if (typeof broadcast !== "object" || broadcast === null || Array.isArray(broadcast)) {
    throw new Error("Forge broadcast must be an object")
  }
  const root = broadcast as Record<string, unknown>
  if (!Array.isArray(root.transactions)) throw new Error("Forge broadcast must contain a transactions array")
  assertNoRegistrationCalls(root.transactions)
  return {
    camRoot: createdContract(root.transactions, "CamRoot"), components: createdContract(root.transactions, "BicycleComponents"),
    manager: createdContract(root.transactions, "BicycleComponentManager"), ui: createdContract(root.transactions, "BicycleComponentManagerUI"),
  }
}

export function assertNoRegistrationCalls(transactions: readonly unknown[]): void {
  const signature = "registerComponent(address,string,string)"
  const selector = toFunctionSelector(signature).toLowerCase()
  for (const value of transactions) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) continue
    const transaction = value as Record<string, unknown>
    if (typeof transaction.function === "string" && transaction.function.startsWith("registerComponent(")) {
      throw new Error("Bike NFT release broadcast must not register fixture components")
    }
    const nested = typeof transaction.transaction === "object" && transaction.transaction !== null && !Array.isArray(transaction.transaction)
      ? transaction.transaction as Record<string, unknown>
      : undefined
    for (const input of [transaction.input, transaction.data, nested?.input, nested?.data]) {
      if (typeof input === "string" && input.toLowerCase().startsWith(selector)) {
        throw new Error("Bike NFT release broadcast must not register fixture components")
      }
    }
  }
}

export function requireHandoff(label: string, deployer: Address, intended: Address, current: Address, pending: Address): void {
  const zero = ZERO_ADDRESS.toLowerCase()
  if (current.toLowerCase() === intended.toLowerCase() && pending.toLowerCase() === zero) return
  if (current.toLowerCase() === deployer.toLowerCase() && pending.toLowerCase() === intended.toLowerCase()) return
  throw new Error(`unexpected ${label} handoff state: deployer=${deployer} intended=${intended} current=${current} pending=${pending}`)
}
