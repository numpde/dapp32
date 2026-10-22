import { checkTimestampStatus } from './timestamp-status-browser-check.mjs'
import { checkActionStyles } from './action-style-browser-check.mjs'
import { checkNftMetadata } from './nft-metadata-browser-check.mjs'
import { checkStartupErrors } from './error-reporting-browser-check.mjs'
// Real CAM browser actions in one owned tab of an existing local CDP browser.
import assert from 'node:assert/strict'
import { createPublicClient, createWalletClient, decodeEventLog, hashTypedData, http, parseAbi, sha256, stringToBytes } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { readBoundedResponseBytes, requireHttpURL, requireSameHttpOrigin } from '@cam/protocol'
import { browserFixtureFailureDetails, checkFixtureWalletToolbar, createCdpCommands, submitFixtureTransaction } from './escrow-browser-fixture.mjs'
import { fixtureFunctionSelectors, fixtureWalletAccounts, fixtureWalletSource } from '../../../tools/browser-fixture-wallet.mjs'
import { assertInvoiceAcceptance, hashInvoice, voucherForInvoice } from '../../../tools/pay-to-play-vouchers/protocol.ts'
import walletConfig from './pay-to-play-fixture-wallet.mjs'

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
    assert(attempts < 11, 'browser fixture transaction grant exhausted')
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
const snapshot = `({timestampMode:document.querySelector('.timestamp-options')?.getAttribute('aria-pressed'),text:document.body.innerText,prepared:!!document.querySelector('.prepared-call'),notices:[...document.querySelectorAll('.notice')].map(x=>x.innerText),transaction:document.querySelector('.transaction-feedback')?.innerText,buttons:[...document.querySelectorAll('button')].map(x=>({name:(x.hasAttribute('aria-label') ? x.getAttribute('aria-label') : x.textContent).trim(),disabled:x.matches(':disabled')})),values:Object.fromEntries([...document.querySelectorAll('.key-value')].map(x=>[x.querySelector('.key-label')?.textContent,x.lastElementChild?.textContent])),width:innerWidth,overflow:document.documentElement.scrollWidth>innerWidth})`
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
async function click(label) {
  assert(await evaluate(`(()=>{const b=[...document.querySelectorAll('button')].find(x=>(x.hasAttribute('aria-label') ? x.getAttribute('aria-label') : x.textContent).trim()===${JSON.stringify(label)});if(!b||b.matches(':disabled'))return false;b.click();return true})()`), `button must be usable: ${label}`)
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
  if (await evaluate(`!![...document.querySelectorAll('button')].find(b=>(b.hasAttribute('aria-label') ? b.getAttribute('aria-label') : b.textContent).trim()==='Change account or channel')`)) await click('Change account or channel')
  await wait(state => state.buttons.some(button => button.name === 'Open balance'), 'balance chooser')
  await fill('lookupCustomer', customer)
  await fill('lookupChannelId', channelId)
  await click('Open balance')
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
  phase = 'action presentation fixture'
  await checkActionStyles({ call, evaluate, viewerURL: viewer.href })
  await checkNftMetadata({ call, evaluate, viewerURL: viewer.href })
  await checkStartupErrors({ call, evaluate, viewerURL: viewer.href })
  phase = 'timestamp display lifecycle fixture'
  await checkTimestampStatus({ call, evaluate, viewerURL: viewer.href })
  await checkFixtureWalletToolbar({ call, evaluate })
  await call('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false })
  await wait(state => state.text.includes('Pay-to-Play'), 'cold entry')
  await click('Connect wallet')
  await wait(state => state.buttons.some(button => button.name === 'Reconnect wallet'), 'wallet connection')
  await fill('newPayee', accounts.recipient.address)
  await fill('newClaimPeriod.seconds', '60')
  await send('Review new channel')
  await wait(state => state.text.includes('Choose an account and channel'), 'creation lookup')
  assert(await evaluate(`document.querySelector('input[name="lookupCustomer"]').value.toLowerCase() === ${JSON.stringify(accounts.admin.address.toLowerCase())} && document.querySelector('input[name="lookupChannelId"]').value === ""`), 'creation lookup prefills the wallet and leaves channel choice explicit')
  const receipt = await publicClient.getTransactionReceipt({ hash: lastHash })
  const creationLogs = receipt.logs.filter(log => log.address.toLowerCase() === payments.toLowerCase())
  assert.equal(creationLogs.length, 1, 'creation receipt must identify one channel')
  const created = decodeEventLog({ abi, eventName: 'ChannelCreated', ...creationLogs[0] })
  const id = String(created.args.channelId)
  await inspect(accounts.customer.address, id)
  disabled(await evaluate(snapshot), 'Review permanent voucher key')
  await role('customer')
  await wait(state => state.buttons.some(button => button.name === 'Review deposit' && !button.disabled), 'customer funding capability')
  disabled(await evaluate(snapshot), 'Review voucher payment')
  await fill('newVoucherKey', voucherSigner.address)
  await send('Review permanent voucher key')
  const registered = await wait(state => state.values['Permanent voucher key (zero means unregistered)']?.toLowerCase() === voucherSigner.address.toLowerCase(), 'registered voucher key')
  disabled(registered, 'Review permanent voucher key')
  await fill('fundAmount', '100')
  await send('Review deposit')
  await wait(state => state.values['Current balance (wei)'] === '100', 'funded balance')
  assert(await evaluate(`document.querySelector('.timestamp-options')===null`), 'app-declared absent timestamps have no display switch')
  await fill('fundAmount', '23')
  await click('Review deposit')
  await wait(state => state.prepared && state.notices.some(value => value.includes('Simulation passed')), 'prepared funding before refresh')
  await click('Refresh')
  await wait(state => !state.prepared && state.buttons.some(button => button.name === 'Refresh' && !button.disabled), 'refresh discards prepared transaction')
  assert(await evaluate(`document.querySelector('input[name="fundAmount"]').value === "23"`), 'refresh preserves the amount draft')
  await fill('withdrawAmount', '40')
  await send('Review withdrawal request')
  await wait(state => state.values['Balance minus withdrawal request (wei)'] === '60', 'request effective balance')
  phase = 'timestamp display preference'
  await evaluate(`(()=>{const originalSet=window.setInterval,originalClear=window.clearInterval,active=new Set();window.__timestampTimers={originalSet,originalClear,active};window.setInterval=(...args)=>{const id=originalSet.apply(window,args);active.add(id);return id};window.clearInterval=id=>{active.delete(id);return originalClear.call(window,id)}})()`)
  assert(await evaluate(`document.querySelector('.timestamp-options').getAttribute('aria-pressed')==='false'`), 'timestamps default to Date')
  await timestampMode(true)
  await wait(state => state.timestampMode === 'true', 'relative timestamp display')
  assert(await evaluate(`window.__timestampTimers.active.size===1`), 'relative display owns one timer')
  await fill('withdrawAmount', '80')
  await send('Review replacement request')
  await wait(state => state.values['Balance minus withdrawal request (wei)'] === '20' && state.values['Withdrawal requested (wei)'] === '80', 'renewed effective balance')
  assert(await evaluate(`document.querySelector('.timestamp-options').getAttribute('aria-pressed')==='true'`), 'same-field timestamp updates retain the display preference')
  await fill('fundAmount', '23')
  await click('Review deposit')
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
  disabled(state, 'Review withdrawal to balance owner')
  disabled(state, 'Review move to another channel')
  disabled(state, 'Review recipient change')
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
  state = await wait(state => state.buttons.some(button => button.name === 'Review deposit' && button.disabled), 'relayer cannot fund inspected customer')
  disabled(state, 'Review withdrawal request')
  disabled(state, 'Review replacement request')
  await fill('cumulativeTotal', '60')
  await fill('invoiceHash', invoiceHash)
  await fill('signature', signature)
  phase = 'voucher signing details'
  await click('View signing details')
  const details = await wait(state => state.text.includes('Voucher signing details'), 'voucher digest')
  assert.equal(details.values['Invoice hash (bytes32)'], invoiceHash)
  assert.equal(details.values['Signing hash (EIP-712 digest)'], hashTypedData(typed))
  phase = 'voucher draft return'
  await click('Back')
  await wait(state => state.values['Read route'] === 'position'
    && state.values['Balance owner']?.toLowerCase() === accounts.customer.address.toLowerCase()
    && state.values['Channel ID'] === id
    && state.buttons.some(button => button.name === 'Review voucher payment' && !button.disabled), 'draft return')
  assert(await evaluate(`document.querySelector('input[name="cumulativeTotal"]')!==null&&document.querySelector('input[name="invoiceHash"]')!==null&&document.querySelector('input[name="signature"]')!==null`), 'returned position must expose the voucher fields')
  assert(await evaluate(`document.querySelector('input[name="cumulativeTotal"]').value === "60" && document.querySelector('input[name="invoiceHash"]').value === ${JSON.stringify(invoiceHash)} && document.querySelector('input[name="signature"]').value === ${JSON.stringify(signature)}`), 'Back restores the complete invoice voucher')
  await send('Review voucher payment')
  await wait(state => state.values['Current balance (wei)'] === '40' && state.values['Total paid by vouchers (wei)'] === '60', 'relayed voucher payment')
  const collectionReceipt = await publicClient.getTransactionReceipt({ hash: lastHash })
  const collectionLogs = collectionReceipt.logs.filter(log => log.address.toLowerCase() === payments.toLowerCase())
  assert.equal(collectionLogs.length, 1)
  const collected = decodeEventLog({ abi, eventName: 'VoucherCollected', ...collectionLogs[0] }).args
  assert.equal(collected.invoiceHash, invoiceHash)
  assert.equal(collected.amount, 60n)
  assert.equal(collected.voucherPaid, 60n)
  assert.equal(collected.customer.toLowerCase(), accounts.customer.address.toLowerCase())
  assert.equal(collected.payee.toLowerCase(), accounts.recipient.address.toLowerCase())
  phase = 'zero-wait recovery channel'
  await role('admin')
  await inspect(accounts.admin.address, '0')
  await fill('newPayee', accounts.recipient.address)
  await fill('newClaimPeriod.seconds', '0')
  await send('Review new channel')
  const recoveryReceipt = await publicClient.getTransactionReceipt({ hash: lastHash })
  const recoveryLog = recoveryReceipt.logs.find(log => log.address.toLowerCase() === payments.toLowerCase())
  assert(recoveryLog, 'recovery channel receipt must contain its creation event')
  const recoveryId = String(decodeEventLog({ abi, eventName: 'ChannelCreated', ...recoveryLog }).args.channelId)
  await inspect(accounts.customer.address, recoveryId)
  await role('customer')
  await wait(state => state.buttons.some(button => button.name === 'Review deposit' && !button.disabled), 'recovery customer')
  await fill('fundAmount', '40')
  await send('Review deposit')
  await click('Manage recovery and channel closure')
  await wait(state => state.buttons.some(button => button.name === 'Review refund recipient' && !button.disabled), 'recovery controls')
  await fill('newRefundRecipient', accounts.recipient.address)
  await send('Review refund recipient')
  await send('Review position wind-down')
  await wait(state => state.buttons.some(button => button.name === 'Review full refund' && !button.disabled), 'zero-wait refund readiness')
  disabled(await evaluate(snapshot), 'Review annual renewal')
  const recipientBefore = await publicClient.getBalance({ address: accounts.recipient.address })
  await role('relayer')
  await wait(state => state.buttons.some(button => button.name === 'Review full refund' && !button.disabled), 'relayer recovery')
  await send('Review full refund')
  await wait(state => state.values['Current balance (wei)'] === '0', 'fully refunded balance')
  assert.equal(await publicClient.getBalance({ address: accounts.recipient.address }), recipientBefore + 40n, 'refund follows the owner-chosen recipient')
  disabled(await evaluate(snapshot), 'Review full refund')
  phase = 'cold-start integrity rejection'
  const beforeTamper = sent
  tamper = true
  await call('Fetch.enable', { patterns: [{ urlPattern: camURI.href, requestStage: 'Request' }] })
  await call('Page.navigate', { url: viewer.href })
  await wait(state => state.text.includes('Cannot load app') && !state.buttons.some(button => button.name === 'Review deposit'), 'tampered manifest rejection')
  await evaluate(`document.querySelector('.error summary').click()`)
  await wait(state => /CAM hash mismatch/i.test(state.text), 'tampered manifest diagnostic')
  assert.equal(sent, beforeTamper, 'integrity rejection must never submit a transaction')
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
