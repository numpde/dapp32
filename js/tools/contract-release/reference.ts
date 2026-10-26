import { bikeContractCreations, bikeContractConfiguration, bikeAdminNominations } from "../bike-nft-release/reference.ts"
import { escrowContractCreation } from "../escrow-release/reference.ts"
import { payToPlayContractCreation, payToPlayAdminNomination } from "../pay-to-play-release/reference.ts"
import { expectedDeployer, type ReleaseReference } from "../release-approval/reference.ts"
import type { ContractReleasePlan } from "./shared.ts"

export function contractDeploymentReference(plan: ContractReleasePlan, independentCreator: string): ReleaseReference {
  const creator = expectedDeployer(independentCreator)
  const steps = plan.app === "escrow" ? [escrowContractCreation()]
    : plan.app === "pay-to-play" ? [payToPlayContractCreation(plan.settings, creator), ...payToPlayAdminNomination(plan.settings, creator)]
    : [...bikeContractCreations(plan.settings, creator), ...bikeContractConfiguration(plan.settings, creator), ...bikeAdminNominations(plan.settings, creator)]
  return { sourceCommit: plan.sourceCommit, expectedChainId: plan.expectedChainId, expectedDeployer: creator, steps }
}
