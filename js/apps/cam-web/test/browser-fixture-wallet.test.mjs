import assert from 'node:assert/strict'
import test from 'node:test'
import vm from 'node:vm'
import { fixtureWalletAccounts, fixtureWalletSource } from '../../../tools/browser-fixture-wallet.mjs'
const address = `0x${'11'.repeat(20)}`
const other = `0x${'22'.repeat(20)}`
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
