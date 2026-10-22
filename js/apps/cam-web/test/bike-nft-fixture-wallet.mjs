// Public accounts for the disposable Bike Anvil fixture only.
export default {
  async collectFacts({ read, latestEvents }) {
    const rows = []
    for (const serialNumber of await latestEvents('BicycleComponentManager', 'ComponentRegistered', 'serialNumber')) {
      const component = await read('BicycleComponentManager', 'componentBySerial', [serialNumber])
      const inactive = await read('BicycleComponentManager', 'inactiveStatus', [serialNumber])
      rows.push({ label: serialNumber, values: [`Token ID: ${component.tokenId}`, `Owner: ${component.owner}`, component.status === 2 ? 'Missing' : 'No missing report', inactive ? 'Out of service' : 'In service'], route: 'component', inputs: { serialNumber }, linkLabel: 'Open component →' })
    }
    return { title: 'Registered bike components', description: 'Serial strings, current owners and service status.', rows }
  },
  initialRole: 'seller',
  accounts: {
    seller: { address: '0xfe7854Bc8cA79FBE9DC94Dfdaf8c10E5C6deCAB7', privateKey: `0x${'ba'.repeat(32)}` },
    mechanic: { address: '0xFe095B24b112B0D2B2A9B8367b7C606e6B8A2308', privateKey: `0x${'bd'.repeat(32)}` },
    buyer: { address: '0xC644588F35654CAd6b566A33D5a62B54748184Ab', privateKey: `0x${'bc'.repeat(32)}` },
  },
  contracts: {
    BicycleComponentManager: ['registerComponent', 'setAccountInfo', 'setComponentMetadata', 'markComponentMissing', 'clearComponentMissing', 'decommissionComponent', 'reactivateComponent', 'setComponentDelegate', 'revokeComponentDelegate'],
    BicycleComponents: ['safeTransferFrom(address,address,uint256)'],
  },
  maxValue: 0n, maxGas: 2000000n, maxCalldataHexLength: 16386,
}
