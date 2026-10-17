// Public accounts for the disposable PayToPlay Anvil fixture only.
export default {
  contract: 'PayToPlay', initialRole: 'customer',
  accounts: {
    admin: { address: '0xfe7854Bc8cA79FBE9DC94Dfdaf8c10E5C6deCAB7', privateKey: `0x${'ba'.repeat(32)}` },
    customer: { address: '0xa55aA83C7090D87b7Aa151346862455D6209D789', privateKey: `0x${'ca'.repeat(32)}` },
    relayer: { address: '0xD722F0C1a90D654D3dFf81E348E0319729D4dA84', privateKey: `0x${'da'.repeat(32)}` },
    recipient: { address: '0x14Dcb427A216216791fB63973c5b13878de30916', privateKey: `0x${'fa'.repeat(32)}` },
  },
  functions: ['createChannel', 'setPayee', 'registerVoucherKey', 'fund', 'requestWithdrawal', 'setWithdrawal', 'withdraw', 'move', 'collect'],
  maxValue: 100000000000000000000n, maxGas: 2000000n, maxCallBytes: 4096,
}
