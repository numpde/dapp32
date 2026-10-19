// Explicit local-write acceptance: a fixture provider in one owned CDP target.
// DOM activation proves application behavior, not physical input or extension UI.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createPublicClient, createWalletClient, http, sha256, parseAbi, toHex } from 'viem'
import { readBoundedResponseBytes, requireHttpURL, requireSameHttpOrigin } from '@cam/protocol'
import { createCdpCommands, lostBroadcastReply, submitFixtureTransaction } from './escrow-browser-fixture.mjs'
import { fixtureFunctionSelectors, fixtureWalletAccounts, fixtureWalletSource } from '../../../tools/browser-fixture-wallet.mjs'
import walletConfig from './escrow-fixture-wallet.mjs'

function endpoint(value, name, local) {
  const parsed = new URL(requireHttpURL(value, name).href)
  if (local) {
    assert.equal(parsed.protocol, 'http:', `${name} must use local HTTP`)
    assert(['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname), `${name} must use loopback`)
  }
  return parsed
}
const cdp = endpoint(process.env.CDP_ORIGIN, 'CDP_ORIGIN', true)
assert(cdp.pathname === '/' && !cdp.search && !cdp.hash, 'CDP_ORIGIN must be an origin')
const viewer = endpoint(process.env.VIEWER_URL, 'VIEWER_URL', true)
const rpcUrl = endpoint(viewer.searchParams.get('rpcUrl'), 'viewer RPC', true)
assert.equal(viewer.searchParams.get('chainId'), 'eip155:31337', 'viewer must select fixture chain')
const camUri = endpoint(process.env.EXPECTED_CAM_URI, 'EXPECTED_CAM_URI', false)
const camHash = process.env.EXPECTED_CAM_HASH
assert(/^0x[0-9a-fA-F]{64}$/.test(camHash), 'CAM SHA-256 digest must be bytes32')
const root = viewer.searchParams.get('host')
assert(/^0x[0-9a-fA-F]{40}$/.test(root), 'missing CAM root address')
const deadline = Date.now() + 240000
// Positional case names let validation replay each failing law independently.
const selectedCases = new Set(process.argv.slice(2))
for (const name of selectedCases) assert(['grant', 'held', 'rejected', 'lost', 'receipt', 'refresh', 'workflow', 'wallet-events', 'chain-navigation', 'empty-navigation', 'chain-failed-navigation', 'empty-failed-navigation'].includes(name), 'unknown browser write case')
async function boundedFetch(location, options) {
  const response = await fetch(location, { ...options, redirect: 'error', signal: AbortSignal.timeout(10000) })
  assert(response.ok, 'fixture resource HTTP request failed')
  return Buffer.from(await readBoundedResponseBytes(response, String(location), 1048576))
}
let rpcId = 0
async function rpc(method, params) {
  const bytes = await boundedFetch(rpcUrl, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, params }),
  })
  const reply = JSON.parse(bytes.toString())
  assert(!reply.error, `fixture RPC ${method} failed`)
  return reply.result
}
async function assertFixtureChain() {
  assert.equal(await rpc('eth_chainId', []), '0x7a69', 'actual RPC must be fixture chain 31337')
}
await assertFixtureChain()
const chain = { id: 31337, name: 'Local fixture', nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: [rpcUrl.href] } } }
const publicClient = createPublicClient({ chain, transport: http(rpcUrl.href, { retryCount: 0, timeout: 10000 }) })
const rootAbi = parseAbi(['function camManifest() view returns ((string uri, bytes32 sha256Digest))', 'function contractAddress(string) view returns (address)'])
const manifest = await publicClient.readContract({ address: root, abi: rootAbi, functionName: 'camManifest' })
assert.equal(manifest.uri, camUri.href)
assert.equal(manifest.sha256Digest.toLowerCase(), camHash.toLowerCase())
const camBytes = await boundedFetch(camUri, {})
assert.equal(sha256(camBytes).toLowerCase(), camHash.toLowerCase(), 'CAM bytes do not match contract SHA-256 digest')
const cam = JSON.parse(camBytes.toString())
const protocolUrl = endpoint(new URL(cam.protocol.uri, camUri).href, 'CAM protocol', false)
requireSameHttpOrigin(protocolUrl.href, camUri.origin, 'CAM protocol')
const protocolBytes = await boundedFetch(protocolUrl, {})
assert.equal(`sha256:${sha256(protocolBytes)}`, cam.protocol.integrity, 'CAM protocol integrity differs')
const declaration = cam.namespaces['contracts.CamEscrow']
assert.equal(declaration.type, 'contract')
const abiUrl = endpoint(new URL(declaration.abiURI, camUri).href, 'Escrow ABI', false)
requireSameHttpOrigin(abiUrl.href, camUri.origin, 'Escrow ABI')
const abiBytes = await boundedFetch(abiUrl, {})
assert.equal(`sha256:0x${createHash('sha256').update(abiBytes).digest('hex')}`, declaration.integrity, 'Escrow ABI integrity differs')
const abi = JSON.parse(abiBytes.toString())
const escrow = await publicClient.readContract({ address: root, abi: rootAbi, functionName: 'contractAddress', args: ['CamEscrow'] })
assert(!/^0x0+$/.test(escrow), 'Escrow binding is missing')
assert.notEqual(await rpc('eth_getCode', [escrow, 'latest']), '0x', 'Escrow binding has no code')
const allowedSelectors = fixtureFunctionSelectors(abi, walletConfig.functions)
const accounts = fixtureWalletAccounts(walletConfig.accounts)
assert.equal(accounts.client.address.toLowerCase(), viewer.searchParams.get('account').toLowerCase(), 'viewer account must be fixture client')
const wallets = Object.fromEntries(Object.entries(accounts).map(([role, account]) => [role, createWalletClient({ account, chain, transport: http(rpcUrl.href, { retryCount: 0, timeout: 10000 }) })]))
const MAX_VALUE = 1000000000000000n
const MAX_GAS = 2000000n
function validatedTransaction(role, tx) {
  assert(Object.hasOwn(accounts, role), 'unknown fixture actor')
  assert(tx && typeof tx === 'object' && !Array.isArray(tx), 'missing transaction')
  assert(Object.keys(tx).every(key => ['from', 'to', 'data', 'value', 'gas'].includes(key)), 'unsupported transaction field')
  assert.equal(tx.from?.toLowerCase(), accounts[role].address.toLowerCase(), 'wrong fixture sender')
  assert.equal(tx.to?.toLowerCase(), escrow.toLowerCase(), 'transaction must target pinned Escrow binding')
  assert(/^0x[0-9a-fA-F]+$/.test(tx.data) && tx.data.length <= 16386, 'invalid or oversized call bytes')
  assert(allowedSelectors.has(tx.data.slice(0, 10).toLowerCase()), 'unsupported fixture action')
  const value = tx.value === undefined ? 0n : BigInt(tx.value)
  assert(value >= 0n && value <= MAX_VALUE, 'fixture value exceeds grant')
  if (tx.gas !== undefined) assert(BigInt(tx.gas) > 0n && BigInt(tx.gas) <= MAX_GAS, 'fixture gas exceeds grant')
  return { account: accounts[role], chain, to: escrow, data: tx.data, value, gas: MAX_GAS }
}

const version = JSON.parse((await boundedFetch(new URL('/json/version', cdp), {})).toString())
const socketUrl = new URL(version.webSocketDebuggerUrl)
assert.equal(socketUrl.protocol, 'ws:')
assert.equal(socketUrl.host, cdp.host, 'CDP advertised a different endpoint')
assert(!socketUrl.username && !socketUrl.password, 'CDP socket must not contain credentials')
const ws = new WebSocket(socketUrl)
await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('CDP connection timed out')), 10000)
  ws.addEventListener('open', () => { clearTimeout(timer); resolve() }, { once: true })
  ws.addEventListener('error', () => { clearTimeout(timer); reject(new Error('CDP connection failed')) }, { once: true })
})
let targetId
let sessionId
let activeCase
let commands
const bridges = new Set()
function call(method, params, session, purpose) {
  return commands.call(method, params, session, purpose)
}
async function evaluate(expression) {
  const result = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessionId)
  assert(!result.exceptionDetails, 'fixture browser expression failed')
  return result.result.value
}
async function bridge(request, owner, ownerSession) {
  let ok = true
  let result
  try {
    assert.equal(request.method, 'eth_sendTransaction', 'unsupported provider method')
    assert.equal(request.params.length, 1, 'send requires exactly one transaction')
    const tx = validatedTransaction(request.role, request.params[0])
    owner.sendRequests++
    assert(owner.sendRequests <= owner.sendLimit, 'fixture case exceeded its transaction grant')
    owner.sendReached = true
    if (owner.mode === 'held') await owner.held
    if (owner.closed || owner.mode === 'held' || owner.mode === 'rejected') {
      ok = false
      result = { code: 4001, message: 'Fixture user rejected the request' }
    } else {
      const hash = await submitFixtureTransaction({ wallet: wallets[request.role], publicClient, transaction: tx, assertChain: assertFixtureChain, shouldContinue: () => !owner.closed })
      if (hash === undefined) return
      owner.sent.push({ role: request.role, hash })
      result = hash
      if (owner.mode === 'lost') {
        ok = false
        result = lostBroadcastReply()
      }
    }
  } catch {
    ok = false
    result = { code: -32602, message: 'Fixture provider rejected an unsupported request' }
  }
  if (!owner.closed) await call('Runtime.evaluate', { expression: `window.__fixtureResolve(${JSON.stringify(request.id)},${ok},${JSON.stringify(result)})` }, ownerSession)
}
ws.addEventListener('message', event => {
  const message = JSON.parse(event.data)
  if (message.id) {
    commands.receive(message)
    return
  }
  if (message.sessionId !== sessionId || !activeCase) return
  if (message.method === 'Runtime.exceptionThrown') activeCase.exceptions++
  if (message.method === 'Runtime.bindingCalled' && message.params.name === 'fixtureWalletBridge') {
    const task = bridge(JSON.parse(message.params.payload), activeCase, sessionId)
    bridges.add(task)
    task.finally(() => bridges.delete(task)).catch(() => {})
  }
})
function providerSource() {
  const addresses = Object.fromEntries(Object.entries(accounts).map(([role, account]) => [role, account.address]))
  return fixtureWalletSource({ accounts: addresses, initialRole: 'client', origin: viewer.origin, host: viewer.searchParams.get('host'), confirmTransactions: false }) + `;
  (()=>{
    const owner=window.__fixtureWallet, request=owner.provider.request;
    window.__fixtureSubmissionMethods=[];window.__fixtureChainSwitches=0;
    window.__fixtureResolve=owner.resolve;
    window.__fixtureSetRole=owner.setRole;
    window.__fixtureEmptyAccounts=owner.disconnect;
    window.__fixtureSetChain=owner.setChain;
    owner.provider.request=options=>{
      if(options.method==='eth_sendTransaction'||options.method==='wallet_sendTransaction')window.__fixtureSubmissionMethods.push(options.method);
      if(options.method==='wallet_switchEthereumChain')window.__fixtureChainSwitches++;
      return request(options);
    };
  })()`
}
const snapshotExpression = `({href:location.href,chainSwitches:window.__fixtureChainSwitches,readReached:window.__fixtureReadReached,text:document.body.innerText, submissionMethods:window.__fixtureSubmissionMethods, account:[...document.querySelectorAll('.connection dt')].find(x=>x.textContent==='Selected account')?.nextElementSibling?.textContent, receiptReached:window.__fixtureReceiptReached, notices:[...document.querySelectorAll('.notice')].map(x=>x.innerText), transaction:document.querySelector('.transaction-feedback')?.innerText, prepared:!!document.querySelector('.prepared-call'), buttons:[...document.querySelectorAll('button')].map(x=>({name:(x.hasAttribute('aria-label') ? x.getAttribute('aria-label') : x.textContent).trim(),disabled:x.matches(':disabled')})), inputs:[...document.querySelectorAll('input')].map(x=>({name:x.name,value:x.value,disabled:x.matches(':disabled')}))})`
async function waitFor(predicate, label) {
  const until = Math.min(deadline, Date.now() + 30000)
  let state
  while (Date.now() < until) {
    state = await evaluate(snapshotExpression)
    if (predicate(state)) return state
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error(`Timed out waiting for ${label}: ${JSON.stringify({ account: state.account, notices: state.notices, transaction: state.transaction, prepared: state.prepared, buttons: state.buttons, sendRequests: activeCase.sendRequests, sent: activeCase.sent.length })}`)
}
function showingActor(state, role) {
  const address = accounts[role].address.toLowerCase()
  return state.account?.toLowerCase().startsWith(address.slice(0, 6))
    && state.account.toLowerCase().endsWith(address.slice(-4))
    && state.buttons.some(button => button.name === 'Reconnect wallet' && !button.disabled)
}
async function click(label) {
  assert(await evaluate(`(() => {const button=[...document.querySelectorAll('button')].find(x=>(x.hasAttribute('aria-label') ? x.getAttribute('aria-label') : x.textContent).trim()===${JSON.stringify(label)});if(!button||button.matches(':disabled'))return false;button.click();return true})()`), `Button unavailable: ${label}`)
}
async function fill(name, value) {
  assert(await evaluate(`(() => {const input=[...document.querySelectorAll('input')].find(x=>x.name===${JSON.stringify(name)});if(!input||input.matches(':disabled'))return false;Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(value)});input.dispatchEvent(new Event('input',{bubbles:true}));return true})()`), `Input unavailable: ${name}`)
}
async function prepare(label) {
  await click(label)
  await waitFor(state => state.prepared && state.notices.some(text => text.includes('Simulation passed')), 'prepared call')
}
async function assertEvidenceAvailability(expected) {
  const state = await evaluate(snapshotExpression)
  for (const [label, fields] of [
    ['Review work evidence submission', ['submissionUri', 'submissionDigest']],
    ['Review submission dispute', ['disputeUri', 'disputeDigest']],
  ]) {
    const enabled = expected.includes(label)
    const button = state.buttons.find(control => control.name === label)
    assert(button, `${label} must remain visible`)
    assert.equal(button.disabled, !enabled, `${label} availability`)
    for (const name of fields) {
      const input = state.inputs.find(control => control.name === name)
      assert(input, `${name} must remain visible`)
      assert.equal(input.disabled, !enabled, `${name} editability`)
    }
    if (!enabled) {
      assert(await evaluate(`(() => {
        const disabled=[...document.querySelectorAll('.action-button')].find(x=>(x.hasAttribute('aria-label') ? x.getAttribute('aria-label') : x.textContent).trim()===${JSON.stringify(label)});
        const enabled=document.querySelector('.action-button:not(:disabled)');
        const appearance=node=>{const style=getComputedStyle(node);return [style.color,style.backgroundColor,style.opacity].join('|')};
        return !!enabled && appearance(disabled)!==appearance(enabled);
      })()`), 'disabled actions must look distinct from enabled actions')
      await evaluate(`(() => {const button=[...document.querySelectorAll('button')].find(x=>(x.hasAttribute('aria-label') ? x.getAttribute('aria-label') : x.textContent).trim()===${JSON.stringify(label)});button.click();return true})()`)
      const after = await evaluate(snapshotExpression)
      assert.equal(after.prepared, state.prepared, 'disabled action must not start preparation')
      assert.deepEqual(after.inputs, state.inputs, 'disabled activation must preserve drafts')
    }
  }
}
async function setupDraft(ref) {
  await click('Connect wallet')
  await waitFor(state => state.text.includes('Wallet connected.'), 'wallet connection')
  await fill('agreementRef', ref)
  await fill('contractor', accounts.contractor.address)
  await fill('arbitrator', accounts.arbitrator.address)
  await fill('amount', String(MAX_VALUE))
  for (const name of ['acceptanceDuration.seconds', 'workDuration.seconds', 'reviewDuration.seconds', 'arbitrationDuration.seconds']) await fill(name, '600')
  await fill('termsUri', 'https://example.test/terms')
  await fill('termsDigest', `0x${'11'.repeat(32)}`)
  await prepare('Review agreement creation')
}
function assertFrozen(state) {
  assert(state.prepared, 'in-flight submission must retain its review')
  assert(state.inputs.every(input => input.disabled), 'in-flight transaction must disable all draft inputs')
  assert(state.buttons.every(button => button.disabled), 'in-flight transaction must disable navigation, wallet and transaction actions')
}
async function nonce() { return BigInt(await rpc('eth_getTransactionCount', [accounts.client.address, 'latest'])) }
async function agreement(ref) {
  return publicClient.readContract({ address: escrow, abi, functionName: 'agreementByReference', args: [accounts.client.address, ref] })
}
async function withCase(mode, test) {
  if (selectedCases.size > 0 && !selectedCases.has(mode)) return
  let release
  const owner = { mode, sendLimit: mode === 'workflow' ? 6 : ['grant', 'wallet-events', 'chain-navigation', 'empty-navigation', 'chain-failed-navigation', 'empty-failed-navigation'].includes(mode) ? 0 : 1, sendRequests: 0, sendReached: false, sent: [], exceptions: 0, closed: false, held: new Promise(resolve => { release = resolve }) }
  commands = createCdpCommands({ socket: ws, runDeadline: deadline, now: Date.now })
  activeCase = owner
  try {
    targetId = (await call('Target.createTarget', { url: 'about:blank', newWindow: false }, undefined)).targetId
    sessionId = (await call('Target.attachToTarget', { targetId, flatten: true }, undefined)).sessionId
    await call('Page.enable', {}, sessionId)
    await call('Runtime.enable', {}, sessionId)
    await call('Runtime.addBinding', { name: 'fixtureWalletBridge' }, sessionId)
    await call('Page.addScriptToEvaluateOnNewDocument', { source: providerSource() }, sessionId)
    await call('Page.navigate', { url: viewer.href }, sessionId)
    await waitFor(state => state.buttons.some(button => button.name === 'Review agreement creation'), 'create view')
    await test(owner, release)
    assert(owner.sendRequests <= owner.sendLimit, `${mode}: unexpected repeated wallet submission`)
    assert.equal(owner.exceptions, 0, `${mode}: unexpected browser exception`)
    console.log(`${mode}: passed (${owner.sent.length} local transactions)`)
  } finally {
    owner.closed = true
    release()
    if (sessionId) await call('Runtime.evaluate', { expression: 'window.__fixtureReleaseReceipt?.();window.__fixtureReleaseRead?.()' }, sessionId, 'cleanup').catch(() => {})
    if (targetId) await call('Target.closeTarget', { targetId }, undefined, 'cleanup').catch(() => {})
    await Promise.allSettled([...bridges])
    commands.close()
    targetId = undefined
    sessionId = undefined
    activeCase = undefined
  }
}
const reference = mode => `browser-${mode}-${Date.now()}-${rpcId}`
async function installReadFault(mode) {
  await evaluate(`(() => {
    const original=window.fetch;let receipt=false, release;
    const held=new Promise(resolve=>{release=resolve});
    window.__fixtureReceiptReached=false;window.__fixtureReleaseReceipt=release;window.__fixtureReadFailures=0;
    window.fetch=async (...args)=>{
      let request;if(typeof args[1]?.body==='string')request=JSON.parse(args[1].body);
      if(receipt&&request?.method==='eth_call'&&${JSON.stringify(mode)}==='refresh'){window.__fixtureReadFailures++;throw new TypeError('Fixture follow-up read failed')}
      const response=await original(...args);
      if(request?.method==='eth_getTransactionReceipt'){
        const reply=await response.clone().json();
        if(reply.result?.status==='0x1'){receipt=true;if(${JSON.stringify(mode)}==='receipt'){window.__fixtureReceiptReached=true;await held}}
      }
      return response;
    };return true;
  })()`)
}
try {
  await withCase('grant', async owner => {
    const before = await nonce()
    const tx = { from: accounts.client.address, to: escrow, data: [...allowedSelectors][0], value: '0x0' }
    const badRequests = [
      { method: 'eth_sendTransaction', params: [{ ...tx, to: root }] },
      { method: 'eth_sendTransaction', params: [{ ...tx, value: toHex(MAX_VALUE + 1n) }] },
      { method: 'eth_sendTransaction', params: [{ ...tx, gas: toHex(MAX_GAS + 1n) }] },
      { method: 'eth_sendTransaction', params: [{ ...tx, data: '0x00000000' }] },
      { method: 'personal_sign', params: [] },
    ]
    for (const request of badRequests) {
      assert(await evaluate(`window.ethereum.request(${JSON.stringify(request)}).then(()=>false,error=>Number.isInteger(error.code))`), 'out-of-grant request must be rejected')
    }
    assert.equal(owner.sendRequests, 0)
    assert.equal(owner.sent.length, 0)
    assert.equal(await nonce(), before, 'provider grant rejection must precede any nonce change')
  })
  await withCase('wallet-events', async owner => {
    await setupDraft(reference('wallet-events'))
    const before = await nonce()
    const prepared = await evaluate(snapshotExpression)
    assert(await evaluate(`(() => {
      const send=[...document.querySelectorAll('button')].find(button=>(button.hasAttribute('aria-label') ? button.getAttribute('aria-label') : button.textContent).trim()==='Send with wallet');
      if(!send||send.disabled)return false;
      window.__fixtureSetChain('0x1');send.click();return true;
    })()`), 'capture enabled Send before same-tick chain change')
    const wrongChain = await waitFor(state => !state.prepared && !state.buttons.some(button => button.name === 'Send with wallet' && !button.disabled), 'chain change revokes prepared send')
    assert.equal(wrongChain.account, prepared.account, 'chain mismatch must retain readonly viewer account')
    assert(wrongChain.buttons.some(button => button.name === 'Review agreement creation'), 'chain mismatch must retain readable view')
    assert.equal(wrongChain.chainSwitches, prepared.chainSwitches, 'stale Send must not request a chain switch')
    assert.deepEqual(wrongChain.submissionMethods, [], 'stale Send must not reach the provider')
    await evaluate("window.__fixtureSetChain('0x7a69');true")
    await prepare('Review agreement creation')
    const retained = await evaluate(snapshotExpression)
    await evaluate('window.__fixtureEmptyAccounts();true')
    const empty = await waitFor(state => !state.prepared && state.buttons.some(button => button.name === 'Connect wallet' && !button.disabled), 'empty accounts revoke signer')
    assert.equal(empty.account, retained.account, 'empty wallet accounts must retain readonly viewer account')
    assert(empty.buttons.some(button => button.name === 'Review agreement creation'), 'empty wallet accounts must retain readable view')
    assert.deepEqual(empty.submissionMethods, [])
    assert.equal(owner.sendRequests, 0)
    assert.equal(await nonce(), before, 'wallet events must not broadcast')
  })
  for (const mode of ['chain-navigation', 'empty-navigation', 'chain-failed-navigation', 'empty-failed-navigation']) {
    await withCase(mode, async owner => {
      await click('Connect wallet')
      await waitFor(state => state.text.includes('Wallet connected.'), 'wallet connection')
      const initial = await evaluate(snapshotExpression)
      await evaluate(`(() => {
        const original=window.fetch;let held=false, release;
        const wait=new Promise(resolve=>{release=resolve});
        window.__fixtureReadReached=false;window.__fixtureReleaseRead=release;
        window.fetch=async (...args)=>{
          let request;if(typeof args[1]?.body==='string')request=JSON.parse(args[1].body);
          if(request?.method==='eth_call'){
            if(!held){held=true;window.__fixtureReadReached=true;await wait}
            if(${JSON.stringify(mode.endsWith('failed-navigation'))})throw new TypeError('Fixture navigation read failed');
          }
          return original(...args);
        };return true;
      })()`)
      if (mode.endsWith('failed-navigation')) await evaluate("location.hash='route=accountCredit';true")
      else await click('View account credit')
      await waitFor(state => state.readReached, 'held navigation read')
      await evaluate(mode.startsWith('chain-')
        ? "window.__fixtureSetChain('0x1');window.__fixtureReleaseRead();true"
        : 'window.__fixtureEmptyAccounts();window.__fixtureReleaseRead();true')
      if (mode.endsWith('failed-navigation')) {
        const restored = await waitFor(state => new URLSearchParams(new URL(state.href).hash.slice(1)).get('route') === 'createAgreementForm', 'failed hash navigation restores committed URL after wallet event')
        assert(restored.buttons.some(button => button.name === 'Review agreement creation'), 'failed navigation must retain previous visible view')
        assert.equal(restored.account, initial.account)
        assert.deepEqual(restored.submissionMethods, [])
        assert.equal(owner.sendRequests, 0)
        return
      }
      const credit = await waitFor(state => state.text.includes('Total withdrawable credit for this account (wei)'), 'navigation commits despite wallet event')
      assert.equal(credit.account, initial.account, 'wallet event must preserve readonly navigation account')
      const creditURL = new URL(credit.href)
      assert.equal(new URLSearchParams(creditURL.hash.slice(1)).get('route'), 'accountCredit', 'URL must publish successful session navigation')
      assert.equal(creditURL.searchParams.get('account').toLowerCase(), accounts.client.address.toLowerCase())
      assert(!credit.buttons.some(button => button.name === 'Send with wallet' && !button.disabled))
      assert.deepEqual(credit.submissionMethods, [])
      await click('Back')
      const restored = await waitFor(state => state.buttons.some(button => button.name === 'Review agreement creation'), 'session history returns from committed credit view')
      assert.equal(new URLSearchParams(new URL(restored.href).hash.slice(1)).get('route'), 'createAgreementForm', 'URL and session history must agree')
      assert.equal(owner.sendRequests, 0)
    })
  }
  await withCase('held', async (owner, release) => {
    const ref = reference('held')
    await setupDraft(ref)
    const before = await nonce()
    await click('Send with wallet')
    const held = await waitFor(() => owner.sendReached, 'held wallet request')
    assertFrozen(held)
    assert.equal(await nonce(), before, 'held request must not broadcast')
    release()
    const rejected = await waitFor(state => state.notices.some(text => /rejected/i.test(text)), 'wallet rejection')
    assert(rejected.prepared && rejected.buttons.some(button => button.name === 'Send with wallet' && !button.disabled), 'rejected unsent call must remain recoverable')
    assert.equal(await nonce(), before)
    assert.equal(owner.sent.length, 0)
    assert.equal((await agreement(ref)).state, 0, 'rejected request must not create an agreement')
  })
  await withCase('rejected', async owner => {
    const ref = reference('rejected')
    await setupDraft(ref)
    const before = await nonce()
    await click('Send with wallet')
    const state = await waitFor(view => view.notices.some(text => /rejected/i.test(text)), 'explicit wallet rejection')
    assert(state.prepared, 'rejection must retain unsent preparation')
    assert(!state.transaction?.includes('may have been sent'), 'explicit rejection must not imply broadcast')
    assert.equal(await nonce(), before)
    assert.equal(owner.sent.length, 0)
    assert.equal((await agreement(ref)).state, 0, 'rejection must leave contract state unchanged')
    await click('Discard transaction')
    await waitFor(view => !view.prepared, 'discard rejected unsent call')
  })
  await withCase('lost', async owner => {
    const ref = reference('lost')
    await setupDraft(ref)
    const before = await nonce()
    await click('Send with wallet')
    const state = await waitFor(view => view.transaction?.includes('may have been sent'), 'uncertain submission')
    assert(!state.prepared, 'uncertain submission must remove retryable preparation')
    assert.equal(owner.sendRequests, 1)
    assert.deepEqual(state.submissionMethods, ['eth_sendTransaction'], 'lost reply must not trigger another wallet submission method')
    assert.equal(owner.sent.length, 1)
    assert.equal((await publicClient.waitForTransactionReceipt({ hash: owner.sent[0].hash, timeout: 30000, pollingInterval: 100 })).status, 'success')
    assert.equal((await agreement(ref)).state, 1, 'lost reply must not erase the actual committed effect')
    assert.equal(await nonce(), before + 1n)
    await fill('agreementRef', reference('edited'))
    await click('View account credit')
    const navigated = await waitFor(view => view.text.includes('Total withdrawable credit for this account (wei)'), 'navigation after uncertain submission')
    assert(navigated.transaction?.includes('may have been sent'), 'ordinary edits/navigation must preserve uncertainty')
    assert(!navigated.buttons.some(button => ['Send with wallet', 'Discard transaction'].includes(button.name)), 'old uncertain call must not offer retry or discard')
    assert.equal(owner.sendRequests, 1, 'navigation must not retry submission')
    assert.equal(await nonce(), before + 1n)
  })
  await withCase('receipt', async owner => {
    await setupDraft(reference('receipt'))
    await installReadFault('receipt')
    await click('Send with wallet')
    const held = await waitFor(asyncState => owner.sent.length === 1 && asyncState.transaction?.includes('Transaction sent:'), 'submitted transaction')
    assertFrozen(held)
    await waitFor(state => state.receiptReached, 'held receipt arrival')
    assertFrozen(await evaluate(snapshotExpression))
    await evaluate('window.__fixtureReleaseReceipt();true')
    await waitFor(state => state.transaction?.includes('Transaction confirmed in block'), 'released receipt')
    assert.equal(owner.sent.length, 1)
  })
  await withCase('refresh', async owner => {
    await setupDraft(reference('refresh'))
    await installReadFault('refresh')
    await click('Send with wallet')
    const state = await waitFor(view => view.notices.some(text => text.includes('confirmed, but the view could not be refreshed')), 'confirmed transaction with failed refresh')
    assert(state.transaction?.includes('Transaction confirmed in block') && state.transaction.includes(owner.sent[0].hash), 'failed refresh must retain confirmed block/hash')
    assert(await evaluate('window.__fixtureReadFailures>0'), 'refresh fault must reach actual follow-up read')
    assert(!state.prepared, 'confirmed call must not remain sendable')
    assert.equal(owner.sent.length, 1)
  })
  await withCase('workflow', async owner => {
    const ref = reference('workflow')
    async function send(label) {
      const count = owner.sent.length
      await prepare(label)
      await click('Send with wallet')
      await waitFor(state => owner.sent.length === count + 1 && state.transaction?.includes(owner.sent[count].hash) && state.transaction.includes('Transaction confirmed in block'), `${label} confirmed`)
    }
    async function actor(role, action) {
      await evaluate(`window.__fixtureSetRole(${JSON.stringify(role)});true`)
      await waitFor(state => showingActor(state, role) && state.buttons.some(button => button.name === action && !button.disabled), `${role} role actions`)
    }
    await setupDraft(ref)
    await click('Send with wallet')
    await waitFor(state => state.transaction?.includes('Transaction confirmed in block') && state.text.includes(ref) && !state.buttons.some(button => button.name === 'Review agreement creation'), 'created agreement')
    await assertEvidenceAvailability([])
    await actor('contractor', 'Review acceptance')
    await assertEvidenceAvailability([])
    await send('Review acceptance')
    await waitFor(state => state.buttons.some(button => button.name === 'Review work evidence submission' && !button.disabled), 'accepted agreement')
    await assertEvidenceAvailability(['Review work evidence submission'])
    await fill('submissionUri', 'https://example.test/submission')
    await fill('submissionDigest', `0x${'22'.repeat(32)}`)
    await send('Review work evidence submission')
    await waitFor(state => /submitted/i.test(state.text), 'submitted agreement')
    await actor('client', 'Review submission dispute')
    await assertEvidenceAvailability(['Review submission dispute'])
    await fill('disputeUri', 'https://example.test/dispute')
    await fill('disputeDigest', `0x${'33'.repeat(32)}`)
    await send('Review submission dispute')
    await waitFor(state => /disputed/i.test(state.text), 'disputed agreement')
    await actor('arbitrator', 'Review dispute resolution for contractor')
    await assertEvidenceAvailability([])
    await send('Review dispute resolution for contractor')
    await waitFor(state => /\bState\s+released\.arbitratorToContractor\b/.test(state.text) && state.buttons.some(button => button.name === 'View account credit' && !button.disabled), 'resolved agreement')
    await assertEvidenceAvailability([])
    await evaluate("window.__fixtureSetRole('contractor');true")
    await waitFor(state => showingActor(state, 'contractor'), 'contractor wallet')
    await click('View account credit')
    const credit = await waitFor(state => state.text.includes('Total withdrawable credit for this account (wei)'), 'contractor credit')
    const match = credit.text.match(/Total withdrawable credit for this account \(wei\)\s+([0-9]+)/)
    assert(match && BigInt(match[1]) >= MAX_VALUE, 'resolution must credit contractor')
    const before = BigInt(await rpc('eth_getBalance', [accounts.contractor.address, 'latest']))
    await fill('recipient', accounts.contractor.address)
    await send('Review withdrawal')
    await waitFor(state => /Total withdrawable credit for this account \(wei\)\s+0\b/.test(state.text), 'withdrawn credit')
    const receipt = await publicClient.getTransactionReceipt({ hash: owner.sent[5].hash })
    const after = BigInt(await rpc('eth_getBalance', [accounts.contractor.address, 'latest']))
    assert.equal(after - before + receipt.gasUsed * receipt.effectiveGasPrice, BigInt(match[1]), 'withdrawal must transfer the displayed credit less gas')
    assert.equal(owner.sent.length, 6)
    assert.deepEqual(owner.sent.map(tx => tx.role), ['client', 'contractor', 'contractor', 'client', 'arbitrator', 'contractor'])
  })
} finally {
  commands?.close()
  ws.close()
}
