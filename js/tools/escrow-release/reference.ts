import type { ExpectedArgument, ExpectedStep } from "../release-approval/reference.ts"

export function escrowUICreation(escrow: ExpectedArgument): ExpectedStep {
  return { kind: "create", role: "ui", name: "CamEscrowUI", action: "Deploy escrow workflow interface", argumentLabels: ["Verified CamEscrow contract"], constructorTypes: ["address"], args: [escrow] }
}

export function escrowUIBinding(ui: ExpectedArgument): ExpectedStep {
  return { kind: "call", role: "camRoot", name: "setContractAddress", action: "Bind the escrow workflow interface in CAM", argumentLabels: ["CAM contract name", "Verified CamEscrowUI contract"], signature: "setContractAddress(string,address)", args: ["CamEscrowUI", ui] }
}

export function escrowContractCreation(): ExpectedStep {
  return { kind: "create", role: "escrow", name: "CamEscrow", action: "Deploy agreement escrow contract", argumentLabels: [], constructorTypes: [], args: [] }
}

export function escrowCamBindings(contracts: { readonly escrow: ExpectedArgument; readonly ui: ExpectedArgument }): ExpectedStep[] {
  return [escrowUIBinding(contracts.ui),
    { kind: "call", role: "camRoot", name: "setContractAddress", action: "Bind the escrow contract in CAM",
      argumentLabels: ["CAM contract name", "Verified CamEscrow contract"], signature: "setContractAddress(string,address)", args: ["CamEscrow", contracts.escrow] },
  ]
}
