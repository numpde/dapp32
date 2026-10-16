// Real CAM browser actions in one owned tab of an existing local CDP browser.
import assert from 'node:assert/strict'
import { AssertionError } from 'node:assert'
import { readFileSync } from 'node:fs'
import { createPublicClient, createWalletClient, http, parseAbi, sha256, toFunctionSelector } from 'viem'
import { readBoundedResponseBytes, requireHttpURL, requireSameHttpOrigin } from '@cam/protocol'
import { createCdpCommands, fixtureAccount, submitFixtureTransaction } from './escrow-browser-fixture.mjs'

function localURL(value, label) {
  const url = requireHttpURL(value, label)
  assert(url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname), `${label} must use loopback HTTP`)
  return url
}
const cdp = localURL(process.env.CDP_ORIGIN, 'CDP_ORIGIN')
assert(cdp.pathname === '/' && !cdp.search && !cdp.hash, 'CDP_ORIGIN must be an origin')
const viewer = localURL(process.env.VIEWER_URL, 'VIEWER_URL')
const rpcURL = localURL(viewer.searchParams.get('rpcUrl'), 'viewer RPC')
const camURI = localURL(process.env.EXPECTED_CAM_URI, 'EXPECTED_CAM_URI')
const camHash = process.env.EXPECTED_CAM_HASH
assert(/^0x[0-9a-fA-F]{64}$/.test(camHash), 'EXPECTED_CAM_HASH must be bytes32')
assert.equal(viewer.searchParams.get('chainId'), 'eip155:31337')
const root = viewer.searchParams.get('host')
assert(/^0x[0-9a-fA-F]{40}$/.test(root), 'viewer host must be a CAM root address')
const deadline = Date.now() + 240_000
let phase = 'verify local publication'
async function bytes(url, options) {
  const response = await fetch(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(10_000) })
  assert(response.ok, 'local fixture HTTP request must succeed')
  return Buffer.from(await readBoundedResponseBytes(response, String(url), 1_048_576))
}
async function rpc(method, params) {
  const result = JSON.parse((await bytes(rpcURL, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  })).toString())
  assert(!result.error, `local fixture RPC ${method} must succeed`)
  return result.result
}
async function assertChain() { assert.equal(await rpc('eth_chainId', []), '0x7a69') }
await assertChain()
const chain = { id: 31337, name: 'Local payment-channel fixture', nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: [rpcURL.href] } } }
const publicClient = createPublicClient({ chain, transport: http(rpcURL.href, { timeout: 10_000, retryCount: 0 }) })
const rootABI = parseAbi(['function camManifest() view returns ((string uri,bytes32 sha256Digest))', 'function contractAddress(string) view returns (address)'])
const manifest = await publicClient.readContract({ address: root, abi: rootABI, functionName: 'camManifest' })
assert.equal(manifest.uri, camURI.href)
assert.equal(manifest.sha256Digest.toLowerCase(), camHash.toLowerCase())
const rootBytes = await bytes(camURI, {})
assert.equal(sha256(rootBytes).toLowerCase(), camHash.toLowerCase())
const cam = JSON.parse(rootBytes.toString())
const resources = new Map()
for (const declaration of [cam.protocol, ...Object.values(cam.namespaces)]) {
  let uri
  if (declaration.type === 'contract') uri = declaration.abiURI
  else uri = declaration.uri
  if (!uri) continue
  const url = new URL(uri, camURI)
  requireSameHttpOrigin(url.href, camURI.origin, 'CAM resource')
  const content = await bytes(url, {})
  assert.equal(`sha256:${sha256(content)}`, declaration.integrity, 'declared CAM resource integrity')
  resources.set(uri, content)
}
const declaration = cam.namespaces['contracts.PayToPlay']
assert.equal(declaration.type, 'contract')
const abi = JSON.parse(resources.get(declaration.abiURI).toString())
const payments = await publicClient.readContract({ address: root, abi: rootABI, functionName: 'contractAddress', args: ['PayToPlay'] })
assert(!/^0x0+$/.test(payments), 'PayToPlay binding must exist')
assert.notEqual(await rpc('eth_getCode', [payments, 'latest']), '0x')
const fixture = readFileSync('/fixture/deploy.yml', 'utf8')
const accounts = {
  admin: fixtureAccount(fixture, 'PRIVATE_KEY', 'ba'),
  customer: fixtureAccount(fixture, 'PAY_TO_PLAY_CUSTOMER_PRIVATE_KEY', 'ca'),
  relayer: fixtureAccount(fixture, 'PAY_TO_PLAY_RELAYER_PRIVATE_KEY', 'da'),
  payee: fixtureAccount(fixture, 'PAY_TO_PLAY_PAYEE_PRIVATE_KEY', 'fa'),
}
assert.equal(viewer.searchParams.get('account').toLowerCase(), accounts.admin.address.toLowerCase())
assert.equal((await publicClient.readContract({ address: payments, abi, functionName: 'owner' })).toLowerCase(), accounts.admin.address.toLowerCase())
const allowed = new Set(['createChannel', 'fund', 'requestWithdrawal', 'setWithdrawal', 'collect'])
const selectors = new Set(abi.filter(item => item.type === 'function' && allowed.has(item.name)).map(toFunctionSelector))
assert.equal(selectors.size, allowed.size)
const wallets = Object.fromEntries(Object.entries(accounts).map(([role, account]) => [role, createWalletClient({ account, chain, transport: http(rpcURL.href, { timeout: 10_000, retryCount: 0 }) })]))
let sent = 0
let attempts = 0
let lastHash
let open = true
let tamper = false
let targetId
let sessionId
const bridgeTasks = new Set()
const version = JSON.parse((await bytes(new URL('/json/version', cdp), {})).toString())
const socket = new URL(version.webSocketDebuggerUrl)
assert.equal(socket.protocol, 'ws:')
assert.equal(socket.host, cdp.host)
assert(!socket.username && !socket.password)
const ws = new WebSocket(socket)
await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('Cannot connect to the existing CDP browser')), 10_000)
  ws.addEventListener('open', () => { clearTimeout(timer); resolve() }, { once: true })
  ws.addEventListener('error', () => { clearTimeout(timer); reject(new Error('Cannot connect to the existing CDP browser')) }, { once: true })
})
const commands = createCdpCommands({ socket: ws, runDeadline: deadline, now: Date.now })
const call = (method, params, purpose) => commands.call(method, params, method.startsWith('Target.') ? undefined : sessionId, purpose)
async function evaluate(expression) {
  const result = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  assert(!result.exceptionDetails, 'owned browser expression must succeed')
  return result.result.value
}
async function bridge(request) {
  let result
  let ok = false
  try {
    assert.equal(request.method, 'eth_sendTransaction')
    assert(Object.hasOwn(accounts, request.role))
    assert.equal(request.params.length, 1)
    const tx = request.params[0]
    assert(Object.keys(tx).every(key => ['from', 'to', 'data', 'value', 'gas'].includes(key)))
    assert.equal(tx.from.toLowerCase(), accounts[request.role].address.toLowerCase())
    assert.equal(tx.to.toLowerCase(), payments.toLowerCase())
    assert(/^0x[0-9a-fA-F]+$/.test(tx.data) && tx.data.length <= 4096)
    assert(selectors.has(tx.data.slice(0, 10)))
    // An omitted EVM transaction value sends no native currency.
    let value = 0n
    if (tx.value !== undefined) value = BigInt(tx.value)
    assert(value >= 0n && value <= 1000n)
    if (tx.gas !== undefined) assert(BigInt(tx.gas) > 0n && BigInt(tx.gas) <= 2_000_000n)
    assert(attempts < 8, 'browser fixture transaction grant exhausted')
    attempts++
    result = await submitFixtureTransaction({
      wallet: wallets[request.role], publicClient,
      transaction: { account: accounts[request.role], chain, to: payments, data: tx.data, value, gas: 2_000_000n },
      assertChain, shouldContinue: () => open,
    })
    if (result === undefined) return
    sent++
    lastHash = result
    ok = true
  } catch {
    result = { code: -32602, message: 'Fixture provider rejected an unsupported payment-channel transaction' }
  }
  if (open) await evaluate(`window.__paymentResolve(${JSON.stringify(request.id)},${ok},${JSON.stringify(result)})`)
}
ws.addEventListener('message', event => {
  const message = JSON.parse(event.data)
  if (message.id) return commands.receive(message)
  if (message.sessionId !== sessionId) return
  if (message.method === 'Runtime.bindingCalled' && message.params.name === 'paymentWalletBridge') {
    const task = bridge(JSON.parse(message.params.payload))
    bridgeTasks.add(task)
    task.finally(() => bridgeTasks.delete(task)).catch(() => {})
  }
  if (message.method === 'Fetch.requestPaused') {
    const task = tamper
      ? call('Fetch.fulfillRequest', { requestId: message.params.requestId, responseCode: 200, responseHeaders: [{ name: 'Content-Type', value: 'application/json' }], body: Buffer.concat([rootBytes, Buffer.from(' ')]).toString('base64') })
      : call('Fetch.continueRequest', { requestId: message.params.requestId })
    task.catch(() => {})
  }
})
const provider = `(() => {
  const accounts=${JSON.stringify(Object.fromEntries(Object.entries(accounts).map(([name, account]) => [name, account.address])))}, pending=new Map(), listeners=new Map();
  let role='admin', next=0;
  window.__paymentResolve=(id,ok,value)=>{const p=pending.get(id);if(!p)return;pending.delete(id);ok?p.resolve(value):p.reject(Object.assign(new Error(value.message),{code:value.code}))};
  window.__paymentRole=value=>{if(!accounts[value])throw Error('unknown fixture role');role=value;const subscriptions=listeners.get('accountsChanged');if(subscriptions)for(const fn of subscriptions)fn([accounts[role]])};
  window.ethereum={
    request:({method,params})=>{
      if(method==='eth_requestAccounts'||method==='eth_accounts')return Promise.resolve([accounts[role]]);
      if(method==='eth_chainId')return Promise.resolve('0x7a69');
      if(method==='wallet_switchEthereumChain'&&params?.[0]?.chainId==='0x7a69')return Promise.resolve(null);
      if(method!=='eth_sendTransaction')return Promise.reject(Object.assign(new Error('Unsupported fixture method'),{code:4200}));
      return new Promise((resolve,reject)=>{const id=++next;pending.set(id,{resolve,reject});window.paymentWalletBridge(JSON.stringify({id,role,method,params}))});
    },
    on:(event,fn)=>{if(!listeners.has(event))listeners.set(event,new Set());listeners.get(event).add(fn);return window.ethereum},
    removeListener:(event,fn)=>listeners.get(event)?.delete(fn)
  };
})()`
const snapshot = `({text:document.body.innerText,prepared:!!document.querySelector('.prepared-call'),notices:[...document.querySelectorAll('.notice')].map(x=>x.innerText),transaction:document.querySelector('.transaction-feedback')?.innerText,buttons:[...document.querySelectorAll('button')].map(x=>({name:x.textContent.trim(),disabled:x.matches(':disabled')})),values:Object.fromEntries([...document.querySelectorAll('.key-value')].map(x=>[x.firstElementChild?.textContent,x.lastElementChild?.textContent])),width:innerWidth,overflow:document.documentElement.scrollWidth>innerWidth})`
async function wait(predicate, label) {
  const until = Math.min(deadline, Date.now() + 30_000)
  while (Date.now() < until) {
    const state = await evaluate(snapshot)
    if (predicate(state)) return state
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error(`Payment-channel browser timed out during ${label}`)
}
async function click(label) {
  assert(await evaluate(`(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()===${JSON.stringify(label)});if(!b||b.matches(':disabled'))return false;b.click();return true})()`), `button must be usable: ${label}`)
}
async function fill(name, value) {
  assert(await evaluate(`(()=>{const e=[...document.querySelectorAll('input')].find(x=>x.name===${JSON.stringify(name)});if(!e||e.matches(':disabled'))return false;Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));return true})()`), `field must be usable: ${name}`)
}
async function send(label) {
  phase = label
  const before = sent
  await click(label)
  await wait(state => state.prepared && state.notices.some(value => value.includes('Simulation passed')), `${label} simulation`)
  await click('Send with wallet')
  await wait(state => sent === before + 1 && state.transaction?.includes(lastHash) && state.transaction.includes('Transaction confirmed in block'), `${label} confirmation`)
}
async function inspect(customer, channelId) {
  await fill('lookupCustomer', customer)
  await fill('lookupChannelId', channelId)
  await click('Open position')
  await wait(state => state.values['Customer being inspected']?.toLowerCase() === customer.toLowerCase() && state.values['Channel ID'] === channelId, 'position lookup')
}
async function role(name) {
  await evaluate(`window.__paymentRole(${JSON.stringify(name)});true`)
  await wait(state => state.buttons.some(button => button.name === 'Switch wallet' && !button.disabled), `${name} account refresh`)
}
function disabled(state, label) {
  const matches = state.buttons.filter(button => button.name === label)
  assert.equal(matches.length, 1, `${label} remains visible`)
  assert(matches[0].disabled, `${label} must be disabled`)
}

try {
  phase = 'open owned existing-browser tab'
  targetId = (await call('Target.createTarget', { url: 'about:blank', newWindow: false })).targetId
  sessionId = (await call('Target.attachToTarget', { targetId, flatten: true })).sessionId
  await call('Page.enable', {})
  await call('Runtime.enable', {})
  await call('Network.enable', {})
  await call('Network.setCacheDisabled', { cacheDisabled: true })
  await call('Runtime.addBinding', { name: 'paymentWalletBridge' })
  await call('Page.addScriptToEvaluateOnNewDocument', { source: provider })
  await call('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false })
  await call('Page.navigate', { url: viewer.href })
  await wait(state => state.text.includes('Service payment channels'), 'cold entry')
  await click('Connect wallet')
  await wait(state => state.buttons.some(button => button.name === 'Switch wallet'), 'wallet connection')
  const id = String(await publicClient.readContract({ address: payments, abi, functionName: 'channelCount' }))
  await fill('newPayee', accounts.payee.address)
  await fill('newClaimPeriod', '60')
  await send('Prepare new channel')
  await inspect(accounts.customer.address, id)
  await role('customer')
  await wait(state => state.buttons.some(button => button.name === 'Prepare funding' && !button.disabled), 'customer funding capability')
  await fill('fundAmount', '100')
  await send('Prepare funding')
  await wait(state => state.values['Balance in wei'] === '100', 'funded balance')
  await fill('withdrawAmount', '40')
  await send('Prepare withdrawal request')
  await wait(state => state.values['Effective balance in wei'] === '60', 'request effective balance')
  await fill('withdrawAmount', '80')
  await send('Prepare replacement / renewal')
  await wait(state => state.values['Effective balance in wei'] === '20' && state.values['Requested withdrawal in wei'] === '80', 'renewed effective balance')
  let state = await evaluate(snapshot)
  disabled(state, 'Prepare mature withdrawal to customer')
  disabled(state, 'Prepare mature movement')
  disabled(state, 'Prepare recipient change')
  phase = '320 pixel form reflow'
  await call('Emulation.setDeviceMetricsOverride', { width: 320, height: 740, deviceScaleFactor: 1, mobile: true })
  state = await evaluate(snapshot)
  assert.equal(state.width, 320)
  assert(!state.overflow, 'payment-channel form must fit a 320px viewport')
  await call('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false })
  const signature = await accounts.customer.signTypedData({
    domain: { name: 'PayToPlay', version: '1', chainId: 31337, verifyingContract: payments },
    types: { Voucher: [{ name: 'customer', type: 'address' }, { name: 'channelId', type: 'uint256' }, { name: 'cumulativeTotal', type: 'uint256' }] },
    primaryType: 'Voucher', message: { customer: accounts.customer.address, channelId: BigInt(id), cumulativeTotal: 60n },
  })
  await role('relayer')
  state = await wait(state => state.buttons.some(button => button.name === 'Prepare funding' && button.disabled), 'relayer cannot fund inspected customer')
  disabled(state, 'Prepare withdrawal request')
  disabled(state, 'Prepare replacement / renewal')
  await fill('cumulativeTotal', '60')
  await fill('signature', signature)
  await send('Prepare voucher collection')
  await wait(state => state.values['Balance in wei'] === '40' && state.values['Lifetime voucher payments in wei'] === '60', 'relayed voucher payment')
  phase = 'cold-start integrity rejection'
  const beforeTamper = sent
  tamper = true
  await call('Fetch.enable', { patterns: [{ urlPattern: camURI.href, requestStage: 'Request' }] })
  await call('Page.navigate', { url: viewer.href })
  await wait(state => state.text.includes('Cannot load viewer') && /CAM hash mismatch/i.test(state.text) && !state.buttons.some(button => button.name === 'Prepare funding'), 'tampered manifest rejection')
  assert.equal(sent, beforeTamper, 'integrity rejection must never submit a transaction')
  process.stdout.write(`${JSON.stringify({ event: 'ok', test: 'pay-to-play browser E2E', transactions: sent, widths: [1280, 320], fixtureChain: 31337 })}\n`)
} catch (error) {
  // SDK errors may embed signature-bearing calldata. Only owned assertion text
  // and the current phase are safe to report from this acceptance runner.
  process.stderr.write(`Payment-channel browser check failed during ${phase}${error instanceof AssertionError ? `: ${error.message}` : ''}.\n`)
  process.exitCode = 1
} finally {
  open = false
  if (targetId) await call('Target.closeTarget', { targetId }, 'cleanup').catch(() => {})
  await Promise.allSettled([...bridgeTasks])
  commands.close()
  ws.close()
}
