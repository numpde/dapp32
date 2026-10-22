import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { collectFixtureFacts } from '../../../tools/browser-fixture-facts.mjs'
import bike from './bike-nft-fixture-wallet.mjs'
import escrow from './escrow-fixture-wallet.mjs'
import payments from './pay-to-play-fixture-wallet.mjs'

const account = `0x${'11'.repeat(20)}`
const currentOwner = `0x${'22'.repeat(20)}`
function contracts(app, names) {
  return Object.fromEntries(names.map(name => [name, { address: currentOwner, abi: JSON.parse(readFileSync(new URL(`../../../../dapps/${app}/cam/abi/${name}.json`, import.meta.url), 'utf8')) }]))
}

test('Bike facts discover exact serial strings and hydrate ownership and lifecycle at one block', async () => {
  const calls = []
  const client = {
    getBlockNumber: async () => 23n,
    getLogs: async args => { calls.push(args); return [{ args: { serialNumber: 'FRAME & # 01' }, blockNumber: 3n, logIndex: 0 }] },
    readContract: async args => {
      calls.push(args)
      if (args.functionName === 'inactiveStatus') return true
      return { exists: true, serialNumber: 'FRAME & # 01', owner: currentOwner, tokenId: 123n, status: 2 }
    },
  }
  const result = await collectFixtureFacts({ client, config: bike, contracts: contracts('bike-nft', ['BicycleComponentManager']), account })
  assert.equal(result.blockNumber, '23')
  assert.equal(result.rows[0].label, 'FRAME & # 01')
  assert.deepEqual(result.rows[0].inputs, { serialNumber: 'FRAME & # 01' })
  assert(result.rows[0].values.some(value => value.includes(currentOwner)))
  assert.match(result.rows[0].values.join(' '), /missing.*out of service/i)
  assert(calls.filter(call => call.functionName).every(call => call.blockNumber === 23n))
  assert(calls.filter(call => call.event).every(call => call.toBlock <= 23n))
})

test('Escrow facts read current references and states instead of treating creation events as current state', async () => {
  const id = `0x${'ab'.repeat(32)}`
  const result = await collectFixtureFacts({ account, config: escrow, contracts: contracts('escrow', ['CamEscrow']), client: {
    getBlockNumber: async () => 7n,
    getLogs: async () => [{ args: { agreementId: id }, blockNumber: 2n, logIndex: 0 }],
    readContract: async args => { assert.equal(args.blockNumber, 7n); return { agreementRef: 'Repair #4', state: 3, client: account, contractor: currentOwner, amount: 50n } },
  } })
  assert.equal(result.rows[0].label, 'Repair #4')
  assert.deepEqual(result.rows[0].inputs, { agreementId: id })
  assert.match(result.rows[0].values.join(' '), /Submitted/)
})

test('Pay-to-Play facts use bounded counter reads and link the requested account without log discovery', async () => {
  const requested = []
  const result = await collectFixtureFacts({ account, config: payments, contracts: contracts('pay-to-play', ['PayToPlay']), client: {
    getBlockNumber: async () => 5n,
    getLogs: async () => assert.fail('Channel discovery must use its counter'),
    readContract: async args => {
      assert.equal(args.blockNumber, 5n)
      if (args.functionName === 'channelCount') return 100n
      requested.push(args.args[0])
      return { payee: currentOwner, claimPeriod: 60n, escrowTotal: 10n, closeAt: 0n }
    },
  } })
  assert.equal(result.rows.length, 20)
  assert.deepEqual(requested, Array.from({ length: 20 }, (_, index) => BigInt(99 - index)))
  assert.deepEqual(result.rows[0].inputs, { customer: account, channelId: '99' })
  assert.match(result.description, /20.*100/)
})

test('event discovery bounds its search and results and propagates failed reads', async () => {
  let requests = 0
  const options = { account, config: bike, contracts: contracts('bike-nft', ['BicycleComponentManager']) }
  const client = {
    getBlockNumber: async () => 50000n,
    getLogs: async args => { requests++; assert(args.fromBlock >= 40001n && args.toBlock <= 50000n); return [] },
    readContract: async () => assert.fail('Empty discovery must not hydrate records'),
  }
  const empty = await collectFixtureFacts({ ...options, client })
  assert.deepEqual(empty.rows, [])
  assert.equal(requests, 10)
  assert.match(empty.scope, /40001.*50000/)
  const failure = new Error('fixture RPC unavailable')
  await assert.rejects(collectFixtureFacts({ ...options, client: { ...client, getLogs: async () => { throw failure } } }), error => error === failure)
  await assert.rejects(collectFixtureFacts({ ...options, client: { ...client, getLogs: async () => Array(2001).fill({}) } }), /too many events/i)
})

test('discovery selects only the newest twenty distinct registrations across chunks', async () => {
  let scans = 0
  let hydrated = 0
  const log = (id, blockNumber) => ({ args: { serialNumber: `SERIAL-${id}` }, blockNumber, logIndex: 0 })
  const result = await collectFixtureFacts({ account, config: bike, contracts: contracts('bike-nft', ['BicycleComponentManager']), client: {
    getBlockNumber: async () => 5000n,
    getLogs: async () => {
      scans++
      assert(scans <= 2, 'discovery stops as soon as its row budget is filled')
      return scans === 1 ? [4, 2, 0, 3, 1].map(id => log(id, 5000n - BigInt(id))) : [log(0, 4000n), ...Array.from({ length: 20 }, (_, i) => log(i + 5, 3999n - BigInt(i))).reverse()]
    },
    readContract: async args => {
      if (args.functionName === 'inactiveStatus') return false
      hydrated++
      return { exists: true, serialNumber: args.args[0], tokenId: 1n, owner: account, status: 1 }
    },
  } })
  assert.equal(scans, 2)
  assert.equal(hydrated, 20)
  assert.deepEqual(result.rows.map(row => row.label), Array.from({ length: 20 }, (_, id) => `SERIAL-${id}`))
})

test('the total deadline rejects a stalled refresh and late reads cannot start more RPC work', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  let release
  let scans = 0
  const pending = collectFixtureFacts({ account, config: bike, contracts: contracts('bike-nft', ['BicycleComponentManager']), client: {
    getBlockNumber: () => new Promise(resolve => { release = resolve }),
    getLogs: async () => { scans++; return [] },
  } })
  t.mock.timers.tick(20000)
  await assert.rejects(pending, /exceeded 20 seconds/)
  release(1n)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(scans, 0)
})
