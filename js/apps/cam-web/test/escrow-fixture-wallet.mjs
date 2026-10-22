// Public accounts for the disposable Escrow Anvil fixture only.
export default {
  initialRole: 'client',
  accounts: {
    client: { address: '0xfe7854Bc8cA79FBE9DC94Dfdaf8c10E5C6deCAB7', privateKey: `0x${'ba'.repeat(32)}` },
    contractor: { address: '0xa55aA83C7090D87b7Aa151346862455D6209D789', privateKey: `0x${'ca'.repeat(32)}` },
    arbitrator: { address: '0xD722F0C1a90D654D3dFf81E348E0319729D4dA84', privateKey: `0x${'da'.repeat(32)}` },
  },
  contracts: { CamEscrow: ['createAgreement', 'cancelAgreement', 'acceptAgreement', 'submitAgreement', 'approveAgreement', 'disputeAgreement', 'resolveForClient', 'resolveForContractor', 'finalizeAcceptanceTimeout', 'finalizeWorkTimeout', 'finalizeReviewTimeout', 'finalizeArbitrationTimeout', 'withdrawTo'] },
  maxValue: 1000000000000000n, maxGas: 2000000n, maxCalldataHexLength: 16386,
}
