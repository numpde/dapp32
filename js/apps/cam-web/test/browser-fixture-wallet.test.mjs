import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import { toFunctionSelector } from 'viem'
import { fixtureFunctionSelectors, fixtureWalletAccounts, fixtureWalletSource } from '../../../tools/browser-fixture-wallet.mjs'
import escrowWalletConfig from './escrow-fixture-wallet.mjs'
import payToPlayWalletConfig from './pay-to-play-fixture-wallet.mjs'
const address = `0x${'11'.repeat(20)}`
const other = `0x${'22'.repeat(20)}`
const fn = (name, inputs) => ({ type: 'function', name, inputs, outputs: [], stateMutability: 'nonpayable' })
function install(existing) {
  const sent = []
  const elements = new Map()
  const make = () => ({ style: {}, children: [], append(...children) { this.children.push(...children) }, remove() { elements.delete(this.id) }, addEventListener(name, fn) { this[name] = fn } })
  const document = { readyState: 'complete', createElement: make, getElementById: id => elements.get(id), body: { prepend(element) { elements.set(element.id, element) } } }
  const window = { ethereum: existing, fixtureWalletBridge: text => sent.push(JSON.parse(text)) }
  const href = 'http://127.0.0.1:5175/?host='+address+'&chainId=eip155:31337'
  const sandbox = { window, document, location: { href }, URL, Map, Set, Error, Object, Promise, JSON, confirm: () => true }
  vm.runInNewContext(fixtureWalletSource({ accounts: { alice: address, bob: other }, initialRole: 'alice', origin: 'http://127.0.0.1:5175', host: address, confirmTransactions: false }), sandbox)
  return { window, owner: window.__fixtureWallet, sent, elements }
}
test('address/key mismatch fails without revealing either key', () => {
  const privateKey = `0x${'ba'.repeat(32)}`
  assert.throws(() => fixtureWalletAccounts({ alice: { address, privateKey } }), error => !String(error).includes(privateKey) && /match/.test(error.message))
})
test('fixture function selectors reject a missing grant masked by another overload', () => {
  const abi = [fn('allowedA', [{ name: 'value', type: 'uint256' }]), fn('allowedA', [{ name: 'value', type: 'address' }])]
  assert.throws(() => fixtureFunctionSelectors(abi, ['allowedA', 'allowedB']), /allowedA.*exactly once/)
})
test('fixture function selectors include one declared grant and ignore unrelated functions', () => {
  const allowed = fn('allowed', [{ name: 'value', type: 'uint256' }])
  const unrelated = fn('unrelated', [])
  assert.deepEqual(
    [...fixtureFunctionSelectors([unrelated, allowed], ['allowed'])],
    [toFunctionSelector(allowed)],
  )
})
test('fixture function grants resolve against their checked-in app ABIs', () => {
  const apps = [
    { name: 'Escrow', config: escrowWalletConfig, abiPath: '../../../../dapps/escrow/cam/abi/CamEscrow.json' },
    { name: 'PayToPlay', config: payToPlayWalletConfig, abiPath: '../../../../dapps/pay-to-play/cam/abi/PayToPlay.json' },
  ]
  for (const app of apps) {
    const abi = JSON.parse(readFileSync(new URL(app.abiPath, import.meta.url), 'utf8'))
    assert.doesNotThrow(() => fixtureFunctionSelectors(abi, app.config.functions), `${app.name} fixture grant`)
  }
})
test('fixture function selectors reject missing, overloaded, and duplicate ABI declarations', () => {
  for (const abi of [
    [],
    [fn('allowed', [{ name: 'value', type: 'uint256' }]), fn('allowed', [{ name: 'value', type: 'address' }])],
    [fn('allowed', [{ name: 'value', type: 'uint256' }]), fn('allowed', [{ name: 'value', type: 'uint256' }])],
  ]) {
    assert.throws(() => fixtureFunctionSelectors(abi, ['allowed']), /allowed.*exactly once/)
  }
})
test('fixture function selectors reject repeated grant names and colliding selectors', () => {
  assert.throws(() => fixtureFunctionSelectors([fn('allowed', [])], ['allowed', 'allowed']), /repeats allowed/)
  const collision = [
    fn('burn', [{ name: 'amount', type: 'uint256' }]),
    fn('collate_propagate_storage', [{ name: 'data', type: 'bytes16' }]),
  ]
  assert.equal(toFunctionSelector(collision[0]), toFunctionSelector(collision[1]))
  assert.throws(() => fixtureFunctionSelectors(collision, ['burn', 'collate_propagate_storage']), /collate_propagate_storage.*shares a selector/)
})
test('refuses an existing wallet without replacing it', () => {
  const existing = { request() {} }
  assert.throws(() => install(existing), /already/)
})
test('selector changes account and emits one real account transition', async () => {
  const { owner, window, elements } = install(undefined)
  const events = []
  window.ethereum.on('accountsChanged', accounts => events.push([...accounts]))
  owner.setRole('bob')
  owner.setRole('bob')
  assert.deepEqual([...await window.ethereum.request({ method: 'eth_accounts' })], [other])
  assert.deepEqual(events, [[other]])
  assert(elements.has('local-fixture-wallet'))
  assert.throws(() => owner.setRole('unknown'), /account/)
})
test('pending send retains its selected account and shutdown rejects pending work', async () => {
  const { owner, window, sent, elements } = install(undefined)
  const pending = window.ethereum.request({ method: 'eth_sendTransaction', params: [{ from: address, to: other, data: '0x12345678' }] })
  owner.setRole('bob')
  assert.equal(sent[0].role, 'alice')
  await assert.rejects(window.ethereum.request({ method: 'eth_sendTransaction', params: [{ from: address }] }), /account/)
  owner.shutdown()
  await assert.rejects(pending, /stopped/)
  assert.equal(window.ethereum, undefined)
  assert(!elements.has('local-fixture-wallet'))
  await assert.rejects(owner.provider.request({ method: 'eth_accounts' }), /stopped/)
})

test('attachment refuses an existing wallet before any install effects', async () => {
  const { installFixtureWalletInTarget } = await import('../../../tools/browser-fixture-wallet.mjs')
  const effects = []
  await assert.rejects(installFixtureWalletInTarget(async method => { effects.push(method); return { result: { value: true } } }, 'fixture source'), /already/)
  assert.deepEqual(effects, ['Runtime.evaluate'])
})
test('dispose removes reload injection and pending provider without closing the tab', async () => {
  const { installFixtureWalletInTarget } = await import('../../../tools/browser-fixture-wallet.mjs')
  const effects = []
  const installed = await installFixtureWalletInTarget(async (method, params) => { effects.push([method, params]); return { result: { value: false }, identifier: 'owned-script' } }, 'fixture source')
  await installed.dispose()
  assert(effects.some(([method, params]) => method === 'Page.removeScriptToEvaluateOnNewDocument' && params.identifier === 'owned-script'))
  assert(effects.some(([method]) => method === 'Runtime.removeBinding'))
  assert(!effects.some(([method]) => method === 'Target.closeTarget'))
})

test('browser source rejects raw key configuration rather than serializing it', () => {
  const privateKey = `0x${'ba'.repeat(32)}`
  assert.throws(() => fixtureWalletSource({ accounts: { alice: { address, privateKey } } }), error => /addresses only/.test(error.message) && !String(error).includes(privateKey))
})

test('reload cannot sign for an old document or resolve a new document request with the same ID', async () => {
  const { fixtureDocumentRequest } = await import('../../../tools/browser-fixture-wallet.mjs')
  const { submitFixtureTransaction } = await import('./escrow-browser-fixture.mjs')
  const documents = new Map([[10, { document: 'old' }]])
  const replies = []
  const effects = []
  let release
  let preparing
  const entered = new Promise(resolve => { preparing = resolve })
  const held = new Promise(resolve => { release = resolve })
  const oldDocument = fixtureDocumentRequest({ executionContextId: 10, documents, isOpen: () => true, call: async (method, params) => replies.push(params) })
  const submission = submitFixtureTransaction({
    wallet: { prepareTransactionRequest: async () => { preparing(); await held; return {} }, signTransaction: async () => { effects.push('sign'); return 'signed' } },
    publicClient: { sendRawTransaction: async () => { effects.push('send'); return 'hash' } },
    transaction: {}, assertChain: async () => {}, shouldContinue: oldDocument.shouldContinue,
  })
  await entered
  documents.delete(10)
  documents.set(10, { document: 'replacement' })
  const newDocument = fixtureDocumentRequest({ executionContextId: 10, documents, isOpen: () => true, call: async (method, params) => replies.push(params) })
  release()
  assert.equal(await submission, undefined)
  await oldDocument.resolve(1, true, 'old hash')
  await newDocument.resolve(1, true, 'new hash')
  assert.deepEqual(effects, [])
  assert.equal(replies.length, 1)
  assert.equal(replies[0].contextId, 10)
  assert(!replies[0].expression.includes('old hash'))
})

for (const failure of ['timeout', 'error', 'close']) {
  test(`failed socket handshake (${failure}) closes the socket and removes initialization listeners`, async () => {
    const { awaitFixtureSocketOpen } = await import('../../../tools/browser-fixture-wallet.mjs')
    const listeners = new Map()
    let closes = 0
    const socket = {
      addEventListener(name, fn) { listeners.set(name, fn) },
      removeEventListener(name, fn) { if (listeners.get(name) === fn) listeners.delete(name) },
      close() { closes++ },
    }
    const opening = awaitFixtureSocketOpen(socket, 5)
    if (failure !== 'timeout') listeners.get(failure)()
    await assert.rejects(opening, /CDP connection/)
    assert.equal(closes, 1)
    assert.equal(listeners.size, 0)
  })
}

test('successful socket handshake releases initialization listeners without closing the live socket', async () => {
  const { awaitFixtureSocketOpen } = await import('../../../tools/browser-fixture-wallet.mjs')
  const listeners = new Map()
  let closes = 0
  const socket = { addEventListener(name, fn) { listeners.set(name, fn) }, removeEventListener(name) { listeners.delete(name) }, close() { closes++ } }
  const opening = awaitFixtureSocketOpen(socket, 5)
  listeners.get('open')()
  await opening
  await new Promise(resolve => setTimeout(resolve, 10))
  assert.equal(closes, 0)
  assert.equal(listeners.size, 0)
})

for (const failure of ['Page.removeScriptToEvaluateOnNewDocument', 'Runtime.evaluate', 'Runtime.removeBinding']) {
  test(`disposal still attempts all owned cleanup after ${failure} fails`, async () => {
    const { installFixtureWalletInTarget } = await import('../../../tools/browser-fixture-wallet.mjs')
    const cleanup = []
    let disposing = false
    const installed = await installFixtureWalletInTarget(async method => {
      if (disposing) { cleanup.push(method); if (method === failure) throw new Error('cleanup transport failed') }
      return { result: { value: false }, identifier: 'owned-script' }
    }, 'fixture source')
    disposing = true
    await assert.rejects(installed.dispose(), error => error instanceof AggregateError && error.errors.length === 1)
    assert.deepEqual(cleanup, ['Page.removeScriptToEvaluateOnNewDocument', 'Runtime.evaluate', 'Runtime.removeBinding'])
  })
}

test('failed script registration releases the binding and retains both initialization and cleanup failures', async () => {
  const { installFixtureWalletInTarget } = await import('../../../tools/browser-fixture-wallet.mjs')
  const effects = []
  await assert.rejects(installFixtureWalletInTarget(async method => {
    effects.push(method)
    if (method === 'Page.addScriptToEvaluateOnNewDocument') throw new Error('registration failed')
    if (method === 'Runtime.removeBinding') throw new Error('binding cleanup failed')
    return { result: { value: false } }
  }, 'fixture source'), error => error instanceof AggregateError && error.errors.length === 2)
  assert.deepEqual(effects, ['Runtime.evaluate', 'Runtime.addBinding', 'Page.addScriptToEvaluateOnNewDocument', 'Runtime.removeBinding'])
})

test('uncertain binding registration attempts removal without touching a reload script or operator tab', async () => {
  const { installFixtureWalletInTarget } = await import('../../../tools/browser-fixture-wallet.mjs')
  const effects = []
  await assert.rejects(installFixtureWalletInTarget(async method => {
    effects.push(method)
    if (method === 'Runtime.addBinding') throw new Error('binding reply lost')
    return { result: { value: false } }
  }, 'fixture source'), error => error instanceof AggregateError && error.errors.length === 1)
  assert.deepEqual(effects, ['Runtime.evaluate', 'Runtime.addBinding', 'Runtime.removeBinding'])
})

test('throwing account subscriber cannot orphan the owned provider or selector during shutdown', () => {
  const { owner, window, elements } = install(undefined)
  window.ethereum.on('accountsChanged', () => { throw new Error('subscriber failed') })
  assert.throws(() => owner.shutdown(), /subscriber failed/)
  assert.equal(window.ethereum, undefined)
  assert.equal(window.__fixtureWallet, undefined)
  assert(!elements.has('local-fixture-wallet'))
})

test('browser shutdown exception is reported while binding removal still runs', async () => {
  const { installFixtureWalletInTarget } = await import('../../../tools/browser-fixture-wallet.mjs')
  const effects = []
  let disposing = false
  const installed = await installFixtureWalletInTarget(async method => {
    effects.push(method)
    if (disposing && method === 'Runtime.evaluate') return { exceptionDetails: { text: 'subscriber failed' } }
    return { result: { value: false }, identifier: 'owned-script' }
  }, 'fixture source')
  disposing = true
  await assert.rejects(installed.dispose(), error => error instanceof AggregateError && /Runtime.evaluate/.test(error.message))
  assert.equal(effects.at(-1), 'Runtime.removeBinding')
})

test('attachment finalization closes its submission gate and transports while retaining primary and disposal failures', async () => {
  const { finishFixtureAttachment } = await import('../../../tools/browser-fixture-wallet.mjs')
  const primary = new Error('reload failed')
  const cleanup = new Error('disposal failed')
  const effects = []
  await assert.rejects(finishFixtureAttachment({
    primaryFailure: primary,
    stopSubmissions() { effects.push('stop submissions') },
    wallet: { async dispose() { effects.push('dispose'); throw cleanup } },
    commands: { close() { effects.push('close commands') } },
    socket: { close() { effects.push('close socket') } },
    pending: [],
  }), error => error instanceof AggregateError && error.errors.includes(primary) && error.errors.includes(cleanup))
  assert.deepEqual(effects, ['stop submissions', 'dispose', 'close commands', 'close socket'])
})
