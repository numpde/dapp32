import { requiredJsonRecord } from "../release-values.ts"
import { createdContract } from "../release-provenance.ts"
import type { CreatedContract } from "../release-provenance.ts"

export type DeploymentContracts = {
  readonly camRoot: CreatedContract
  readonly camEscrow: CreatedContract
  readonly camEscrowUI: CreatedContract
}

export function deploymentContractsFromBroadcast(broadcast: unknown): DeploymentContracts {
  const root = requiredJsonRecord(broadcast, "Forge broadcast")
  if (!Array.isArray(root.transactions)) {
    throw new Error("Forge broadcast must contain a transactions array")
  }

  return {
    camRoot: createdContract(root.transactions, "CamRoot"),
    camEscrow: createdContract(root.transactions, "CamEscrow"),
    camEscrowUI: createdContract(root.transactions, "CamEscrowUI"),
  }
}
