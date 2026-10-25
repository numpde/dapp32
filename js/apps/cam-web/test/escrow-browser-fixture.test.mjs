import assert from 'node:assert/strict'
import test from 'node:test'
import { createWalletClient, custom, HttpRequestError, parseAbi } from 'viem'
import { createCdpCommands, fixtureAccount, lostBroadcastReply, submitFixtureTransaction } from './escrow-browser-fixture.mjs'
import * as fixture from './escrow-browser-fixture.mjs'
import { checkActionStyles } from './action-style-browser-check.mjs'
import { checkNftMetadata } from './nft-metadata-browser-check.mjs'
import { checkViewerConnection } from './connection-browser-check.mjs'
import { checkStartupErrors } from './error-reporting-browser-check.mjs'
import { checkTimestampStatus } from './timestamp-status-browser-check.mjs'

for (const failedPhase of ['preparation', 'deployment before signing', 'signing', 'deployment before broadcast', 'broadcast']) {
  test(`fixture ${failedPhase} failure reports the actual submission boundary and preserves its cause`, async () => {
    const cause = new Error('CAM manifest hash changed')
    const effects = []
    let checks = 0
    async function phase(name) { effects.push(name); if (name === failedPhase) throw cause }
    await assert.rejects(submitFixtureTransaction({
      wallet: {
        prepareTransactionRequest: async () => { await phase('preparation'); return {} },
        signTransaction: async () => { await phase('signing'); return 'signed' },
      },
      publicClient: { sendRawTransaction: async () => { await phase('broadcast'); return 'hash' } },
      assertChain: async () => phase(++checks === 1 ? 'deployment before signing' : 'deployment before broadcast'),
      shouldContinue: () => true,
      transaction: {},
    }), error => {
      assert.equal(error.cause, cause)
      assert.equal(error.data.submission, failedPhase === 'broadcast' ? 'unknown' : 'not-submitted')
      assert.match(error.data.diagnostic, /CAM manifest hash changed/)
      return true
    })
    assert.equal(effects.at(-1), failedPhase, 'a failed phase must stop all later effects')
  })
}

test('actual wallet contract writes preserve fixture evidence without inventing a revert or submitting twice', async () => {
  assert.equal(typeof fixture.fixtureSubmissionFailure, 'function')
  for (const submission of ['not-submitted', 'unknown']) {
    const effects = []
    const providerFailure = fixture.fixtureSubmissionFailure(new Error('CAM manifest hash changed'), submission)
    const wallet = createWalletClient({ transport: custom({ request: async ({ method }) => {
      effects.push(method)
      throw providerFailure
    } }, { retryCount: 0 }) })
    await assert.rejects(wallet.writeContract({
      account: `0x${'11'.repeat(20)}`, chain: null,
      address: `0x${'22'.repeat(20)}`, abi: parseAbi(['function update(bytes32 digest)']),
      functionName: 'update', args: [`0x${'33'.repeat(32)}`],
    }), error => {
      assert(!error.shortMessage.includes('reverted'), 'fixture processing failure is not evidence of a contract revert')
      let current = error
      while (current !== providerFailure && current !== undefined) current = current.cause
      assert.equal(current, providerFailure)
      return true
    })
    assert.deepEqual(effects, ['eth_sendTransaction'])
  }
})

test('fixture failure diagnostics retain transport evidence without signed request bodies', () => {
  assert.equal(typeof fixture.fixtureSubmissionFailure, 'function')
  const signed = 'SIGNED_TRANSACTION_MUST_NOT_CROSS_THE_BRIDGE'
  const cause = new HttpRequestError({ url: 'http://fixture.invalid/rpc', body: { method: 'eth_sendRawTransaction', params: [signed] }, details: 'Connection closed' })
  const failure = fixture.fixtureSubmissionFailure(cause, 'unknown')
  assert.match(failure.data.diagnostic, /Connection closed/)
  assert(!JSON.stringify(failure).includes(signed))
})

test('wallet toolbar check preserves its failure and attempts page cleanup if viewport restoration fails', async () => {
  const primary = new Error('viewport change failed')
  const cleanup = new Error('viewport restoration failed')
  let pageCleaned = false
  let evaluations = 0
  await assert.rejects(fixture.checkFixtureWalletToolbar({
    call: async method => { throw method === 'Emulation.clearDeviceMetricsOverride' ? cleanup : primary },
    evaluate: async () => { evaluations++; if (evaluations === 1) return { x: 0, y: 200 }; if (evaluations === 3) pageCleaned = true },
  }), error => error instanceof AggregateError && error.errors[0] === primary && error.errors[1] === cleanup)
  assert(pageCleaned)
})

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

const viewerURL = 'http://127.0.0.1:5186/?chainId=eip155:31337'
for (const check of [checkActionStyles, checkTimestampStatus, checkNftMetadata, checkStartupErrors, checkViewerConnection]) {
  test(`${check.name} restores a committed, complete viewer before returning its original failure`, async () => {
    const primary = new Error('fixture operation failed')
    let release
    let settled = false
    let reads = 0
    const observed = []
    const observations = [0, 1].map(index => new Promise(resolve => { observed[index] = resolve }))
    const ready = new Promise(resolve => { release = resolve })
    const pending = check({
      viewerURL,
      call: async (method, params) => {
        if (method === 'Page.navigate' && params.url !== viewerURL) throw primary
        return { loaderId: 'restored-viewer' }
      },
      evaluate: async () => {
        const index = reads++
        if (index === 0) { observed[0](); return { href: 'http://127.0.0.1:5186/test/old-fixture.html', readyState: 'complete' } }
        if (index === 1) { observed[1](); return { href: viewerURL, readyState: 'loading' } }
        return ready
      },
    }).then(() => { settled = true }, error => { settled = true; return error })
    try {
      for (const observation of observations) {
        await Promise.race([observation, pending.then(() => assert.fail('restoration returned before reading the complete expected document'))])
        await new Promise(resolve => setImmediate(resolve))
        assert(!settled, 'an old complete document or a new loading document must not finish restoration')
      }
    } finally {
      release({ href: `${new URL(viewerURL).origin}/?chainId=eip155%3A31337#route=home`, readyState: 'complete' })
    }
    assert.equal(await pending, primary, 'successful cleanup preserves the original error object')
  })

  test(`${check.name} retains the primary and independent cleanup failures`, async () => {
    const primary = new Error('fixture operation failed')
    const metrics = new Error('viewport restoration failed')
    const navigation = new Error('viewer restoration failed')
    const calls = []
    await assert.rejects(check({
      viewerURL,
      call: async (method, params) => {
        calls.push(method)
        if (method === 'Emulation.clearDeviceMetricsOverride') throw metrics
        if (method === 'Page.navigate') throw params.url === viewerURL ? navigation : primary
      },
      evaluate: async () => ({ href: viewerURL, readyState: 'complete' }),
    }), error => error instanceof AggregateError && error.errors[0] === primary
      && error.errors.includes(metrics) && error.errors.includes(navigation))
    assert.equal(calls.filter(method => method === 'Page.navigate').length, 2, 'viewport failure must not skip viewer restoration')
  })
}

test('timestamp keyboard focus is released even when enabling it has an uncertain outcome', async () => {
  const uncertain = new Error('focus acknowledgement lost')
  const calls = []
  await assert.rejects(checkTimestampStatus({
    viewerURL,
    call: async (method, params) => {
      calls.push([method, params])
      if (method === 'Emulation.setFocusEmulationEnabled' && params.enabled) throw uncertain
    },
    evaluate: async expression => expression.includes('count:rows.length')
      ? { count: 3, aligned: true, fullWidth: true, pill: true, overflow: false }
      : expression.includes('location.href') ? { href: viewerURL, readyState: 'complete' } : true,
  }), error => error === uncertain)
  assert.deepEqual(calls.filter(([method]) => method === 'Emulation.setFocusEmulationEnabled').map(([, params]) => params.enabled), [true, false])
  assert(!calls.some(([method]) => method === 'Input.dispatchKeyEvent'), 'uncertain focus must not proceed to keyboard dispatch')
  const release = calls.findIndex(([method, params]) => method === 'Emulation.setFocusEmulationEnabled' && !params.enabled)
  const restore = calls.findLastIndex(([method]) => method === 'Page.navigate')
  assert(release < restore, 'release focus before returning to the app')
})

test('browser reporting exposes owned command failures without exposing provider bodies', async () => {
  assert.equal(typeof fixture.browserFixtureFailureDetails, 'function')
  const marker = 'SIGNATURE_BODY_MUST_NOT_BE_PRINTED'
  const provider = new HttpRequestError({ url: 'http://fixture.invalid/rpc', body: { method: 'eth_sendRawTransaction', params: [marker] } })
  assert(provider.message.includes(marker), 'the actual SDK diagnostic embeds the request body')
  assert.equal(fixture.browserFixtureFailureDetails(provider), '')
  let commands
  commands = createCdpCommands({
    runDeadline: Date.now() + 1000,
    now: Date.now,
    socket: { send: text => {
      const request = JSON.parse(text)
      queueMicrotask(() => commands.receive({ id: request.id, error: { message: marker } }))
    } },
  })
  try {
    let failure
    try { await commands.call('Page.navigate', { url: viewerURL }) } catch (error) { failure = error }
    const details = fixture.browserFixtureFailureDetails(new AggregateError([failure, provider], 'browser fixture failed'))
    assert.match(details, /Page\.navigate/)
    assert(!details.includes(marker), 'provider bodies and CDP payloads stay out of stderr')
  } finally { commands.close() }
})
