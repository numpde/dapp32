import { checkTimestampStatus } from './timestamp-status-browser-check.mjs'
import { checkActionStyles } from './action-style-browser-check.mjs'
import { checkNftMetadata } from './nft-metadata-browser-check.mjs'
import { checkStartupErrors } from './error-reporting-browser-check.mjs'
import { checkViewerConnection } from './connection-browser-check.mjs'
// Real CAM browser actions in one owned tab of an existing local CDP browser.
import assert from 'node:assert/strict'
import { createPublicClient, createWalletClient, decodeEventLog, decodeFunctionData, encodeFunctionData, hashTypedData, http, parseAbi, sha256, stringToBytes } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { readBoundedResponseBytes, requireHttpURL, requireSameHttpOrigin } from '@cam/protocol'
import { browserFixtureFailureDetails, checkFixtureWalletToolbar, createCdpCommands, fixtureSubmissionFailure, submitFixtureTransaction } from './escrow-browser-fixture.mjs'
import { assertFixtureTransactionFields, fixtureFunctionSelectors, fixtureWalletAccounts, fixtureWalletSource } from '../../../tools/browser-fixture-wallet.mjs'
import { assertInvoiceAcceptance, hashInvoice, voucherForInvoice } from '../../../tools/pay-to-play-vouchers/protocol.ts'
import walletConfig from './pay-to-play-fixture-wallet.mjs'

function showsExactWei(value, wei) {
  return typeof value === 'string' && value.endsWith(`(${BigInt(wei).toLocaleString('en-US')} Wei (smallest unit))`)
}

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
const accounts = fixtureWalletAccounts(walletConfig.accounts)
// Public, unfunded voucher-only key for this disposable local fixture, never a live key.
const voucherSigner = privateKeyToAccount(`0x${'55'.repeat(32)}`)
assert.equal(viewer.searchParams.get('account').toLowerCase(), accounts.admin.address.toLowerCase())
assert.equal((await publicClient.readContract({ address: payments, abi, functionName: 'owner' })).toLowerCase(), accounts.admin.address.toLowerCase())
const selectors = fixtureFunctionSelectors(abi, walletConfig.contracts.PayToPlay)
const wallets = Object.fromEntries(Object.entries(accounts).map(([role, account]) => [role, createWalletClient({ account, chain, transport: http(rpcURL.href, { timeout: 10_000, retryCount: 0 }) })]))
let sent = 0
let attempts = 0
let lastHash
let interleaveCreation = false
let interveningCreation
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
    assertFixtureTransactionFields(tx, chain)
    assert.equal(tx.from.toLowerCase(), accounts[request.role].address.toLowerCase())
    assert.equal(tx.to.toLowerCase(), payments.toLowerCase())
    assert(/^0x[0-9a-fA-F]+$/.test(tx.data) && tx.data.length <= 4096)
    assert(selectors.has(tx.data.slice(0, 10)))
    // An omitted EVM transaction value sends no native currency.
    let value = 0n
    if (tx.value !== undefined) value = BigInt(tx.value)
    assert(value >= 0n && value <= 1000n)
    if (tx.gas !== undefined) assert(BigInt(tx.gas) > 0n && BigInt(tx.gas) <= 2_000_000n)
    if (interleaveCreation) {
      assert.equal(request.role, 'admin')
      assert.equal(decodeFunctionData({ abi, data: tx.data }).functionName, 'createChannel')
      interleaveCreation = false
      const hash = await submitFixtureTransaction({
        wallet: wallets.admin, publicClient,
        transaction: { account: accounts.admin, chain, to: payments, data: encodeFunctionData({ abi, functionName: 'createChannel', args: [accounts.recipient.address, accounts.relayer.address, 60n] }), value: 0n, gas: 2_000_000n },
        assertChain, shouldContinue: () => open,
      })
      assert(hash, 'intervening fixture creation must be submitted')
      const mined = await publicClient.waitForTransactionReceipt({ hash })
      assert.equal(mined.status, 'success')
      interveningCreation = mined.transactionHash
    }
    assert(attempts < 13, 'browser fixture transaction grant exhausted')
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
  } catch (cause) {
    result = fixtureSubmissionFailure(cause, 'not-submitted')
  }
  if (open) await evaluate(`window.__fixtureWallet.resolve(${JSON.stringify(request.id)},${ok},${JSON.stringify(result)})`)
}
ws.addEventListener('message', event => {
  const message = JSON.parse(event.data)
  if (message.id) return commands.receive(message)
  if (message.sessionId !== sessionId) return
  if (message.method === 'Runtime.bindingCalled' && message.params.name === 'fixtureWalletBridge') {
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
const provider = fixtureWalletSource({
  accounts: Object.fromEntries(Object.entries(accounts).map(([name, account]) => [name, account.address])),
  initialRole: 'admin', origin: viewer.origin, host: root, confirmTransactions: false,
})
const snapshot = `(()=>{
  const facts=scope=>{
    if(scope===null)return {};
    return Object.fromEntries([...scope.querySelectorAll('.key-value')].map(row=>{
      const cell=row.lastElementChild;
      const identifier=cell.querySelector('.hex-value code');
      return [row.querySelector('.key-label').textContent,identifier===null?cell.textContent:identifier.title];
    }));
  };
  return {
    readRoute:[...document.querySelectorAll('.ui-meta .key-value')].find(row=>row.querySelector('dt')?.textContent==='Read route')?.querySelector('dd')?.textContent,
    tasks:[...document.querySelectorAll('.elements .ui-section > h2')].map(node=>node.textContent),
    fields:[...document.querySelectorAll('.elements input')].map(node=>node.name),
    timestampMode:document.querySelector('.timestamp-options')?.getAttribute('aria-pressed'),
    text:document.body.innerText,prepared:!!document.querySelector('.prepared-call'),
    notices:[...document.querySelectorAll('.notice')].map(x=>x.innerText),
    transaction:document.querySelector('.transaction-feedback')?.innerText,
    transactionHash:document.querySelector('.transaction-feedback .hex-value code')?.title,
    buttons:[...document.querySelectorAll('button')].map(x=>({name:(x.hasAttribute('aria-label')?x.getAttribute('aria-label'):x.textContent).trim(),disabled:x.matches(':disabled')})),
    values:facts(document),reviewValues:facts(document.querySelector('.prepared-call')),resultValues:facts(document.querySelector('.transaction-feedback')),
    width:innerWidth,overflow:document.documentElement.scrollWidth>innerWidth
  };
})()`
async function wait(predicate, label) {
  const until = Math.min(deadline, Date.now() + 30_000)
  while (Date.now() < until) {
    const state = await evaluate(snapshot)
    if (predicate(state)) return state
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  assert.fail(`Payment-channel browser timed out during ${label}`)
}
async function timestampMode(relative) {
  assert(await evaluate(`(()=>{const b=document.querySelector('button.timestamp-options');if(!b)return false;if(b.getAttribute('aria-pressed')!==${JSON.stringify(String(relative))})b.click();return true})()`), 'timestamp pill remains usable')
  await wait(state => state.timestampMode === String(relative), 'timestamp display mode')
}
async function assertHierarchy(route, peers, nested) {
  const actual = await evaluate(`(()=>{
    const body=document.querySelector('.elements');
    const headings=[...body.querySelectorAll('h2')];
    return {
      brand:document.querySelector('h1')?.textContent,
      peers:headings.map(node=>node.textContent),
      direct:headings.every(node=>node.parentElement.parentElement===body),
      boundaries:headings.slice(1).every(node=>parseFloat(getComputedStyle(node.parentElement).borderTopWidth)>0),
      nested:[...body.querySelectorAll('h3')].map(node=>[node.textContent,node.parentElement.parentElement.closest('.ui-section')?.querySelector(':scope > h2')?.textContent])
    };
  })()`)
  assert.equal((await evaluate(snapshot)).readRoute, route)
  assert.equal(actual.brand, 'Pay-to-Play')
  assert.deepEqual(actual.peers, peers, `${route} peer headings`)
  assert(actual.direct && actual.boundaries, `${route} task sections own their boundaries`)
  assert.deepEqual(actual.nested, nested, `${route} only genuine subtasks are nested`)
}

async function click(label) {
  assert(await evaluate(`(()=>{const b=[...document.querySelectorAll('button')].find(x=>(x.hasAttribute('aria-label') ? x.getAttribute('aria-label') : x.textContent).trim()===${JSON.stringify(label)});if(!b||b.matches(':disabled'))return false;b.click();return true})()`), `button must be usable: ${label}`)
}
async function fill(name, value) {
  assert(await evaluate(`(()=>{const e=[...document.querySelectorAll('input')].find(x=>x.name===${JSON.stringify(name)});if(!e||e.matches(':disabled'))return false;Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));return true})()`), `field must be usable: ${name}`)
}
async function send(label, inspectReview) {
  phase = label
  const before = sent
  await click(label)
  await wait(state => state.prepared && state.notices.some(value => value.includes('Simulation passed')), `${label} simulation`)
  if (inspectReview !== undefined) await inspectReview(await evaluate(snapshot))
  await click('Send with wallet')
  await wait(state => sent === before + 1 && state.transactionHash === lastHash && state.transaction.includes('Transaction confirmed in block') && !state.prepared && state.buttons.some(button => button.name === 'Refresh' && !button.disabled), `${label} confirmation and refreshed view`)
}
async function inspect(customer, channelId) {
  if (await evaluate(`!![...document.querySelectorAll('button')].find(b=>(b.hasAttribute('aria-label') ? b.getAttribute('aria-label') : b.textContent).trim()==='Change account or channel')`)) {
    await click('Change account or channel')
    await wait(state => state.readRoute === 'choosePosition', 'context-preserving chooser')
    await assertHierarchy('choosePosition', ['View a balance', 'Create a channel (admin only)'], [])
  }
  await wait(state => state.buttons.some(button => button.name === 'View balance'), 'balance chooser')
  await fill('lookupCustomer', customer)
  await fill('lookupChannelId', channelId)
  await click('View balance')
  await wait(state => state.values['Balance owner']?.toLowerCase() === customer.toLowerCase() && state.values['Channel ID'] === channelId, 'position lookup')
}
async function role(name) {
  await evaluate(`(()=>{const select=document.getElementById("local-fixture-wallet-role");select.value=${JSON.stringify(name)};select.dispatchEvent(new Event("change"));return true})()`)
  await wait(state => state.buttons.some(button => button.name === 'Reconnect wallet' && !button.disabled), `${name} account refresh`)
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
  await call('Runtime.addBinding', { name: 'fixtureWalletBridge' })
  await call('Page.addScriptToEvaluateOnNewDocument', { source: provider })
  await call('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false })
  await call('Page.navigate', { url: viewer.href })
  await call('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false })
  await wait(state => state.text.includes('Pay-to-Play'), 'cold entry')
  await assertHierarchy('home', ['View a balance', 'Create a channel (admin only)'], [])
  await click('Connect wallet')
  await wait(state => state.buttons.some(button => button.name === 'Reconnect wallet'), 'wallet connection')
  await fill('newPayee', accounts.recipient.address)
  await fill('newChannelCollector', accounts.relayer.address)
  await fill('newClaimPeriod.seconds', '60')
  const { result: simulatedId } = await publicClient.simulateContract({ address: payments, abi, functionName: 'createChannel', args: [accounts.recipient.address, accounts.relayer.address, 60n], account: accounts.admin.address })
  interleaveCreation = true
  await send('Create channel')
  const lookup = await wait(state => state.readRoute === 'channelLookup' && state.tasks.includes('View a balance') && state.fields.includes('lookupChannelId'), 'creation receipt lookup')
  assert(!lookup.buttons.some(button => button.name === 'Create channel'), 'receipt lookup must not repeat the channel creation form')
  await assertHierarchy('channelLookup', ['View a balance'], [])
  assert(await evaluate(`document.querySelector('input[name="lookupCustomer"]').value.toLowerCase() === ${JSON.stringify(accounts.admin.address.toLowerCase())} && document.querySelector('input[name="lookupChannelId"]').value === ""`), 'creation lookup prefills the wallet and leaves channel choice explicit')
  const receipt = await publicClient.getTransactionReceipt({ hash: lastHash })
  const creationLogs = receipt.logs.filter(log => log.address.toLowerCase() === payments.toLowerCase() && decodeEventLog({ abi, ...log }).eventName === 'ChannelCreated')
  assert.equal(creationLogs.length, 1, 'creation receipt must identify one channel')
  const created = decodeEventLog({ abi, eventName: 'ChannelCreated', ...creationLogs[0] })
  const id = String(created.args.channelId)
  assert.equal(BigInt(id), simulatedId + 1n, 'another creation mined after simulation changes the actual ID')
  assert.equal(lookup.resultValues['Created channel ID'], id, 'creation result uses the mined event ID')
  assert.equal(lookup.resultValues.Payee.toLowerCase(), accounts.recipient.address.toLowerCase())
  await call('Emulation.setDeviceMetricsOverride', { width: 320, height: 900, deviceScaleFactor: 1, mobile: false })
  assert(!(await evaluate(snapshot)).overflow, 'created channel facts and handoff fit a narrow viewport')
  await call('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false })
  await click('View balance in this channel')
  await wait(state => state.readRoute === 'position' && state.values['Channel ID'] === id, 'open mined channel from receipt')
  await assertHierarchy('position', ['Account and channel', 'Position status', 'Balance overview', 'Channel', 'Deposit', 'Withdraw or move funds', 'Voucher signing key', 'Voucher payments', 'Channel settings'], [['Change payment recipient', 'Channel settings'], ['Change collector', 'Channel settings']])
  await inspect(accounts.customer.address, id)
  disabled(await evaluate(snapshot), 'Register permanent voucher key')
  await role('customer')
  await wait(state => state.buttons.some(button => button.name === 'Deposit' && !button.disabled), 'customer funding capability')
  assert.equal((await evaluate(snapshot)).values['Position phase'], 'Operating')
  await click('Deposit')
  await wait(state => state.notices.some(value => value.includes('Enter a value for Amount to deposit')), 'missing deposit feedback')
  assert(await evaluate(`(()=>{const field=document.querySelector('input[name="fundAmount"]');return field.getAttribute('aria-invalid')==='true'&&document.getElementById(field.getAttribute('aria-describedby')).textContent==='Enter an amount.'&&document.querySelector('input[name="withdrawAmount"]').getAttribute('aria-invalid')==='false'&&!document.querySelector('.prepared-call')})()`), 'only the submitted empty editor is invalid and no review is prepared')
  assert.equal(sent, 1, 'empty deposit must not send a transaction')
  disabled(await evaluate(snapshot), 'Collect voucher payment')
  await fill('newVoucherKey', voucherSigner.address)
  await send('Register permanent voucher key')
  const registered = await wait(state => state.values['Permanent voucher key (zero means unregistered)']?.toLowerCase() === voucherSigner.address.toLowerCase(), 'registered voucher key')
  disabled(registered, 'Register permanent voucher key')
  await fill('fundAmount', '100')
  await send('Deposit')
  await wait(state => showsExactWei(state.values['Current balance'], '100'), 'funded balance')
  assert(await evaluate(`(()=>{const row=[...document.querySelectorAll('dl')].find(row=>row.querySelector('dt')?.textContent==='Withdrawal ready at');return row&&!row.querySelector('.timestamp-options')})()`), 'the absent withdrawal timestamp has no display switch even while recovery deadlines exist')
  await fill('fundAmount', '23')
  await click('Deposit')
  await wait(state => state.prepared && state.notices.some(value => value.includes('Simulation passed')), 'prepared funding before refresh')
  await click('Refresh')
  await wait(state => !state.prepared && state.buttons.some(button => button.name === 'Refresh' && !button.disabled), 'refresh discards prepared transaction')
  assert(await evaluate(`document.querySelector('input[name="fundAmount"]').value === "23"`), 'refresh preserves the amount draft')
  await fill('withdrawAmount', '40')
  await send('Request withdrawal')
  await wait(state => showsExactWei(state.values['Balance minus withdrawal request'], '60'), 'request effective balance')
  phase = 'timestamp display preference'
  await evaluate(`(()=>{const originalSet=window.setInterval,originalClear=window.clearInterval,active=new Set();window.__timestampTimers={originalSet,originalClear,active};window.setInterval=(...args)=>{const id=originalSet.apply(window,args);active.add(id);return id};window.clearInterval=id=>{active.delete(id);return originalClear.call(window,id)}})()`)
  assert(await evaluate(`document.querySelector('.timestamp-options').getAttribute('aria-pressed')==='false'`), 'timestamps default to Date')
  await timestampMode(true)
  await wait(state => state.timestampMode === 'true', 'relative timestamp display')
  assert(await evaluate(`window.__timestampTimers.active.size===1`), 'relative display owns one timer')
  await fill('withdrawAmount', '80')
  await send('Replace withdrawal request')
  await wait(state => showsExactWei(state.values['Balance minus withdrawal request'], '20') && showsExactWei(state.values['Withdrawal requested'], '80'), 'renewed effective balance')
  assert(await evaluate(`document.querySelector('.timestamp-options').getAttribute('aria-pressed')==='true'`), 'same-field timestamp updates retain the display preference')
  await fill('fundAmount', '23')
  await click('Deposit')
  await wait(state => state.prepared, 'prepared transaction before display switch')
  await timestampMode(false)
  assert(await evaluate(`window.__timestampTimers.active.size===0`), 'Date display releases its timer')
  assert(await evaluate(`document.querySelector('.prepared-call')!==null&&document.querySelector('input[name="fundAmount"]').value==='23'`), 'timestamp display does not edit drafts or discard a reviewed transaction')
  await timestampMode(true)
  await click('Refresh')
  await wait(state => !state.prepared && state.buttons.some(button => button.name === 'Refresh' && !button.disabled), 'relative display survives reread')
  assert(await evaluate(`document.querySelector('.timestamp-options').getAttribute('aria-pressed')==='true'&&window.__timestampTimers.active.size===1`), 'refresh retains the display choice without multiplying timers')
  await inspect(accounts.customer.address, '0')
  await wait(state => state.text.includes('No active withdrawal request'), 'timestamp becomes absent')
  assert(await evaluate(`document.querySelector('.timestamp-options')===null&&window.__timestampTimers.active.size===0`), 'absence removes display controls and releases its timer')
  await inspect(accounts.customer.address, id)
  await wait(state => state.timestampMode === 'false', 'timestamp returns on newly opened balance')
  await timestampMode(false)
  await evaluate(`(()=>{const t=window.__timestampTimers;window.setInterval=t.originalSet;window.clearInterval=t.originalClear;delete window.__timestampTimers})()`)
  let state = await evaluate(snapshot)
  disabled(state, 'Withdraw to balance owner')
  disabled(state, 'Move funds to another channel')
  disabled(state, 'Change channel payee')
  phase = '320 pixel form reflow'
  await call('Emulation.setDeviceMetricsOverride', { width: 320, height: 740, deviceScaleFactor: 1, mobile: true })
  state = await evaluate(snapshot)
  assert.equal(state.width, 320)
  assert(!state.overflow, 'payment-channel form must fit a 320px viewport')
  await call('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false })
  phase = 'prepare relayed voucher'
  const now = (await publicClient.getBlock()).timestamp
  const invoice = assertInvoiceAcceptance({
    version: '1', purchaseId: sha256(stringToBytes('browser fixture purchase')),
    merchant: accounts.recipient.address, customer: accounts.customer.address,
    chainId: '31337', paymentContract: payments, channelId: id,
    previousTotal: '0', cumulativeTotal: '60', acceptBefore: (now + 3600n).toString(),
    termsHash: sha256(stringToBytes('browser fixture purchase terms')),
  }, {
    chainId: 31337n, paymentContract: payments, customer: accounts.customer.address,
    channelId: BigInt(id), merchant: accounts.recipient.address, previousTotal: 0n, now,
  })
  const invoiceHash = hashInvoice(invoice)
  const typed = voucherForInvoice(invoice)
  const signature = await voucherSigner.signTypedData(typed)
  await inspect(accounts.customer.address, id)
  await role('relayer')
  state = await wait(state => state.buttons.some(button => button.name === 'Deposit' && button.disabled), 'relayer cannot fund inspected customer')
  disabled(state, 'Request withdrawal')
  disabled(state, 'Replace withdrawal request')
  await fill('cumulativeTotal', '60')
  await fill('maxAmount', '30')
  await fill('invoiceHash', invoiceHash)
  await fill('signature', signature)
  phase = 'voucher signing details'
  await click('View signing details')
  const details = await wait(state => state.text.includes('Voucher signing details'), 'voucher digest')
  await assertHierarchy('voucherDigest', ['Account and channel', 'Voucher signing details'], [['Signing domain', 'Voucher signing details'], ['Signing key', 'Voucher signing details'], ['Voucher message', 'Voucher signing details']])
  assert.equal(details.values['Invoice hash (bytes32)'], invoiceHash)
  assert.equal(details.values['Signing hash (EIP-712 digest)'], hashTypedData(typed))
  phase = 'voucher draft return'
  await click('Back')
  await wait(state => state.values['Read route'] === 'position'
    && state.values['Balance owner']?.toLowerCase() === accounts.customer.address.toLowerCase()
    && state.values['Channel ID'] === id
    && state.buttons.some(button => button.name === 'Collect voucher payment' && !button.disabled), 'draft return')
  assert(await evaluate(`document.querySelector('input[name="cumulativeTotal"]')!==null&&document.querySelector('input[name="invoiceHash"]')!==null&&document.querySelector('input[name="signature"]')!==null`), 'returned position must expose the voucher fields')
  assert(await evaluate(`document.querySelector('input[name="cumulativeTotal"]').value === "60" && document.querySelector('input[name="invoiceHash"]').value === ${JSON.stringify(invoiceHash)} && document.querySelector('input[name="signature"]').value === ${JSON.stringify(signature)}`), 'Back restores the complete invoice voucher')
  const paymentReceipts = []
  for (const paidTotal of [30n, 60n]) {
    await fill('cumulativeTotal', '60')
    await fill('maxAmount', '30')
    await fill('invoiceHash', invoiceHash)
    await fill('signature', signature)
    await send('Collect voucher payment', async review => {
      assert.equal(review.reviewValues['Estimated payment (may change before confirmation)'], '0.00000000000000003 Native coins (30 Wei (smallest unit))')
      assert.equal(review.reviewValues['Current payee (may change before confirmation)'].toLowerCase(), accounts.recipient.address.toLowerCase())
      if (paidTotal === 30n) {
        await call('Emulation.setDeviceMetricsOverride', { width: 320, height: 900, deviceScaleFactor: 1, mobile: false })
        assert(!(await evaluate(snapshot)).overflow, 'collection estimate fits a narrow viewport')
        await call('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false })
      }
    })
    const paid = await wait(state => showsExactWei(state.values['Current balance'], 100n - paidTotal) && showsExactWei(state.values['Total paid by vouchers'], paidTotal), 'partial voucher payment')
    assert.equal(paid.resultValues['Paid'], '0.00000000000000003 Native coins (30 Wei (smallest unit))')
    assert.equal(paid.resultValues['Paid to'].toLowerCase(), accounts.recipient.address.toLowerCase())
    const collectionReceipt = await publicClient.getTransactionReceipt({ hash: lastHash })
    const collectionLogs = collectionReceipt.logs.filter(log => log.address.toLowerCase() === payments.toLowerCase())
    assert.equal(collectionLogs.length, 1)
    const collected = decodeEventLog({ abi, eventName: 'VoucherCollected', ...collectionLogs[0] }).args
    assert.equal(collected.invoiceHash, invoiceHash)
    assert.equal(collected.amount, 30n)
    assert.equal(collected.voucherPaid, paidTotal)
    assert.equal(collected.customer.toLowerCase(), accounts.customer.address.toLowerCase())
    assert.equal(collected.payee.toLowerCase(), accounts.recipient.address.toLowerCase())
    paymentReceipts.push({ hash: collectionReceipt.transactionHash, paid: String(collected.amount), payee: collected.payee })
  }
  await fill('cumulativeTotal', '60')
  await fill('maxAmount', '30')
  await fill('invoiceHash', invoiceHash)
  await fill('signature', signature)
  await send('Collect voucher payment', review => assert.equal(review.reviewValues['Estimated payment (may change before confirmation)'], '0 Native coins (0 Wei (smallest unit))'))
  const zeroPayment = await wait(state => showsExactWei(state.resultValues['Paid'], '0') && state.buttons.some(button => button.name === 'Refresh' && !button.disabled), 'successful zero collection')
  assert(zeroPayment.transaction.includes('No payment collected'))
  assert.equal(zeroPayment.resultValues['Paid to'], undefined, 'zero result cannot retain an earlier payment recipient')
  const zeroReceipt = await publicClient.getTransactionReceipt({ hash: lastHash })
  assert.equal(zeroReceipt.logs.filter(log => log.address.toLowerCase() === payments.toLowerCase()).length, 0)
  await call('Emulation.setDeviceMetricsOverride', { width: 320, height: 900, deviceScaleFactor: 1, mobile: false })
  assert(!(await evaluate(snapshot)).overflow, 'the zero-payment receipt fits a narrow viewport')
  await call('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false })
  process.stdout.write(`${JSON.stringify({ event: 'ok', test: 'payment outcomes and actual channel handoff', created: { hash: receipt.transactionHash, channelId: id, simulatedId: String(simulatedId), interveningCreation }, payments: paymentReceipts, zero: { hash: zeroReceipt.transactionHash, paid: zeroPayment.resultValues['Paid'] }, widths: [1280, 320] })}\n`)
  phase = 'zero-wait recovery channel'
  await role('admin')
  await inspect(accounts.admin.address, '0')
  await click('Change account or channel')
  await wait(state => state.readRoute === 'choosePosition' && state.fields.includes('newPayee'), 'new channel task on chooser')
  await fill('newPayee', accounts.recipient.address)
  await fill('newChannelCollector', accounts.relayer.address)
  await fill('newClaimPeriod.seconds', '0')
  await send('Create channel')
  const recoveryReceipt = await publicClient.getTransactionReceipt({ hash: lastHash })
  const recoveryLog = recoveryReceipt.logs.find(log => log.address.toLowerCase() === payments.toLowerCase() && decodeEventLog({ abi, ...log }).eventName === 'ChannelCreated')
  assert(recoveryLog, 'recovery channel receipt must contain its creation event')
  const recoveryId = String(decodeEventLog({ abi, eventName: 'ChannelCreated', ...recoveryLog }).args.channelId)
  await inspect(accounts.customer.address, recoveryId)
  await role('customer')
  await wait(state => state.buttons.some(button => button.name === 'Deposit' && !button.disabled), 'recovery customer')
  await fill('fundAmount', '40')
  await send('Deposit')
  await click('Manage recovery and channel closure')
  await wait(state => state.buttons.some(button => button.name === 'Set refund recipient' && !button.disabled), 'recovery controls')
  await assertHierarchy('recovery', ['Account and channel', 'Position status', 'Balance recovery', 'Retire this channel'], [['Renew funding period', 'Balance recovery'], ['Choose refund recipient', 'Balance recovery'], ['Start wind-down', 'Balance recovery'], ['Refund balance', 'Balance recovery']])
  await fill('newRefundRecipient', accounts.recipient.address)
  await send('Set refund recipient')
  await send('Start position wind-down')
  await wait(state => state.buttons.some(button => button.name === 'Refund full balance' && !button.disabled), 'zero-wait refund readiness')
  assert.equal((await evaluate(snapshot)).values['Position phase'], 'Refund-only', 'recovery displays the authoritative readable phase')
  disabled(await evaluate(snapshot), 'Renew position')
  const recipientBefore = await publicClient.getBalance({ address: accounts.recipient.address })
  await role('relayer')
  await wait(state => state.buttons.some(button => button.name === 'Refund full balance' && !button.disabled), 'relayer recovery')
  await send('Refund full balance')
  await wait(state => showsExactWei(state.values['Current balance'], '0'), 'fully refunded balance')
  assert.equal(await publicClient.getBalance({ address: accounts.recipient.address }), recipientBefore + 40n, 'refund follows the owner-chosen recipient')
  disabled(await evaluate(snapshot), 'Refund full balance')
  phase = 'cold-start integrity warning'
  const beforeTamper = sent
  tamper = true
  await call('Fetch.enable', { patterns: [{ urlPattern: camURI.href, requestStage: 'Request' }] })
  await call('Page.navigate', { url: viewer.href })
  await wait(state => state.readRoute === cam.entry && state.text.includes('This file does not match the verification hash stored in the contract.') && state.buttons.some(button => button.name === 'Create channel'), 'tampered manifest warning with rendered home')
  assert.equal(sent, beforeTamper, 'displaying an integrity warning must never submit a transaction')

  tamper = false
  await call('Fetch.disable', {})
  phase = 'action presentation fixture'
  await checkActionStyles({ call, evaluate, viewerURL: viewer.href })
  await checkNftMetadata({ call, evaluate, viewerURL: viewer.href })
  await checkViewerConnection({ call, evaluate, viewerURL: viewer.href })
  await checkStartupErrors({ call, evaluate, viewerURL: viewer.href })
  phase = 'timestamp display lifecycle fixture'
  await checkTimestampStatus({ call, evaluate, viewerURL: viewer.href })
  await checkFixtureWalletToolbar({ call, evaluate })
  process.stdout.write(`${JSON.stringify({ event: 'ok', test: 'pay-to-play browser E2E', transactions: sent, widths: [1280, 320], fixtureChain: 31337 })}\n`)
} catch (error) {
  const details = browserFixtureFailureDetails(error)
  process.stderr.write(`Payment-channel browser check failed during ${phase}${details === '' ? '' : `: ${details}`}.\n`)
  process.exitCode = 1
} finally {
  open = false
  if (targetId) await call('Target.closeTarget', { targetId }, 'cleanup').catch(() => {})
  await Promise.allSettled([...bridgeTasks])
  commands.close()
  ws.close()
}
