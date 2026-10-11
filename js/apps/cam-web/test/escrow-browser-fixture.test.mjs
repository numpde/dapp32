import assert from 'node:assert/strict'
import test from 'node:test'
import { createWalletClient, custom } from 'viem'
import { createCdpCommands, fixtureAccount, lostBroadcastReply, submitFixtureTransaction } from './escrow-browser-fixture.mjs'

for (const failure of ['lost broadcast reply', 'transport exception']) {
  test(`${failure} must not ask the actual wallet SDK to submit again through another method`, async () => {
    const methods = []
    let accepted = 0
    const wallet = createWalletClient({
      transport: custom({ request: async ({ method }) => {
        methods.push(method)
        if (method !== 'eth_sendTransaction') throw Object.assign(new Error('Unsupported fixture wallet method'), { code: 4200 })
        accepted++
        if (failure === 'transport exception') throw new TypeError('Fixture transport disconnected after acceptance')
        const reply = lostBroadcastReply()
        throw Object.assign(new Error(reply.message), { code: reply.code })
      } }, { retryCount: 0 }),
    })
    await assert.rejects(wallet.sendTransaction({ account: `0x${'11'.repeat(20)}`, chain: null, to: `0x${'22'.repeat(20)}`, value: 1n }))
    assert.equal(accepted, 1, 'fixture must model one accepted submission')
    assert.deepEqual(methods, ['eth_sendTransaction'], 'uncertainty must not be represented as an unsupported input or method')
  })
}

test('fixture key denials never serialize expected or supplied key bytes', () => {
  const expected = `0x${'ba'.repeat(32)}`
  for (const supplied of [`0x${'ca'.repeat(32)}`, `0x${'12'.repeat(32)}`]) {
    let failure
    try { fixtureAccount(`PRIVATE_KEY: "${supplied}"`, 'PRIVATE_KEY', 'ba') } catch (error) { failure = error }
    assert(failure, 'non-fixture key must be rejected')
    const rendered = [String(failure), failure.stack, JSON.stringify(failure)].join('\n')
    assert(!rendered.includes(supplied), 'denial leaked supplied key')
    assert(!rendered.includes(expected), 'denial leaked expected key')
  }
})

for (const stoppedPhase of ['preparation', 'chain before signing', 'signing', 'chain before broadcast']) {
  test(`closed submission owner cannot start later effects after ${stoppedPhase}`, async () => {
    let open = true
    let release
    let reached
    const blocked = new Promise(resolve => { release = resolve })
    const entered = new Promise(resolve => { reached = resolve })
    const effects = []
    let chains = 0
    async function phase(name) {
      effects.push(name)
      if (name === stoppedPhase) { reached(); await blocked }
    }
    const pending = submitFixtureTransaction({
      wallet: {
        prepareTransactionRequest: async () => { await phase('preparation'); return { fixture: true } },
        signTransaction: async () => { await phase('signing'); return 'fixture serialized transaction' },
      },
      publicClient: { sendRawTransaction: async () => { await phase('broadcast'); return 'fixture hash' } },
      transaction: { fixture: true },
      assertChain: async () => { await phase(++chains === 1 ? 'chain before signing' : 'chain before broadcast') },
      shouldContinue: () => open,
    })
    await entered
    open = false
    release()
    assert.equal(await pending, undefined, 'closed run must not report a new submitted transaction')
    assert.equal(effects.at(-1), stoppedPhase, 'closure must prevent every subsequent external phase')
    assert(!effects.includes('broadcast'), 'closed owner must not consume a nonce by broadcasting')
  })
}

test('expired run can close only its owned target under a separate cleanup budget', async () => {
  let clock = 100
  const sent = []
  let commands
  commands = createCdpCommands({
    runDeadline: 100,
    now: () => clock,
    socket: { send: text => {
      const request = JSON.parse(text)
      sent.push(request)
      queueMicrotask(() => commands.receive({ id: request.id, result: { success: true } }))
    } },
  })
  try {
    assert.throws(() => commands.call('Target.createTarget', { url: 'about:blank' }, undefined, 'work'), /deadline/)
    await commands.call('Target.closeTarget', { targetId: 'owned-target' }, undefined, 'cleanup')
    assert.deepEqual(sent.map(request => [request.method, request.params]), [['Target.closeTarget', { targetId: 'owned-target' }]])
    assert.throws(() => commands.call('Target.createTarget', { url: 'about:blank' }, undefined, 'cleanup'), /cleanup/)
    clock += 60001
    assert.throws(() => commands.call('Runtime.evaluate', { expression: 'release held receipt' }, 'owned-session', 'cleanup'), /deadline/)
  } finally { commands.close() }
})
