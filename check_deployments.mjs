import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const cdp = new URL(process.env.CDP_ORIGIN)
assert(cdp.protocol === 'http:' && !cdp.username && !cdp.password)
const site = process.env.SITE_ROOT
const page = 'https://numpde.github.io/dapp32/deployments/'
const catalogURL = 'https://raw.githubusercontent.com/numpde/dapp32/main/js/packages/cam-viewer/src/rpc-catalog.json'
const files = new Map()
for (const [url, path, type] of [
  [page, 'deployments/index.html', 'text/html'],
  [page + 'deployments.js', 'deployments/deployments.js', 'text/javascript'],
  [page + 'deployments.json', 'deployments/deployments.json', 'application/json'],
  ['https://numpde.github.io/dapp32/site.css', 'site.css', 'text/css'],
]) files.set(url, { body: await readFile(`${site}/${path}`), type })
const production = JSON.parse(files.get(page + 'deployments.json').body)
const host = production.deployments[0].host
const fixture = { viewer: production.viewer, deployments: [{ ...production.deployments[0], network: 'fixture', contracts: ['Registry', 'UI', 'Unbound'] }] }
const publicRPC = 'https://rpc.fixture.test/'
const customRPC = 'https://custom.fixture.test/'
const catalog = { fixture: { name: 'Fixture', chainId: 31337, services: { public: publicRPC, keyed: 'https://rpc.fixture.test/{API_KEY}' }, explorer: 'https://explorer.fixture.test' } }
const addresses = ['0x' + '1'.repeat(40), '0x' + '2'.repeat(40)]
let mode = 'success', live = false, failData = false, observed = [], held = []
const version = await (await fetch(new URL('/json/version', cdp), { signal: AbortSignal.timeout(5000) })).json()
assert.equal(new URL(version.webSocketDebuggerUrl).host, cdp.host)
const socket = new WebSocket(version.webSocketDebuggerUrl)
await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true })
  socket.addEventListener('error', reject, { once: true })
  setTimeout(() => reject(new Error('Browser connection timed out')), 5000).unref()
})
let id = 0, sessionId, targetId, interceptionError
const pending = new Map()
function call(method, params = {}, session = sessionId) {
  return new Promise((resolve, reject) => {
    const requestId = ++id
    const timer = setTimeout(() => { pending.delete(requestId); reject(new Error(`${method} timed out`)) }, 15000)
    pending.set(requestId, { resolve, reject, timer })
    socket.send(JSON.stringify({ id: requestId, method, params, ...(session ? { sessionId: session } : {}) }))
  })
}
async function fulfill(request, body, type = 'application/json', status = 200) {
  await call('Fetch.fulfillRequest', { requestId: request.requestId, responseCode: status, responseHeaders: [{ name: 'Content-Type', value: type }, { name: 'Access-Control-Allow-Origin', value: '*' }, { name: 'Access-Control-Allow-Methods', value: 'POST, OPTIONS' }, { name: 'Access-Control-Allow-Headers', value: 'Content-Type' }], body: Buffer.from(body).toString('base64') })
}
async function intercept(request) {
  const url = request.request.url.split('?')[0]
  if (files.has(url)) {
    const file = files.get(url)
    return fulfill(request, url === page + 'deployments.json' && !live ? JSON.stringify(fixture) : file.body, file.type, failData && url === page + 'deployments.json' ? 503 : 200)
  }
  if (url === catalogURL) return live ? call('Fetch.continueRequest', { requestId: request.requestId }) : fulfill(request, JSON.stringify(catalog))
  if (request.request.method === 'OPTIONS') return fulfill(request, '', 'text/plain', 204)
  const message = JSON.parse(request.request.postData)
  observed.push({ url, ...message })
  if (mode === 'held' && url === publicRPC) { held.push(request); return }
  if (mode === 'fail') return fulfill(request, '', 'text/plain', 503)
  const response = { jsonrpc: '2.0', id: message.id }
  if (message.method === 'eth_chainId') response.result = mode === 'wrong-chain' ? '0x1' : '0x7a69'
  else if (message.method === 'eth_blockNumber') response.result = '0x123'
  else {
    assert.equal(message.method, 'eth_call', 'Page must never send writes')
    assert.equal(message.params[0].to, host)
    assert.equal(message.params[1], '0x123', 'All bindings must use the captured block')
    const bytes = Buffer.from(message.params[0].data.slice(2), 'hex')
    assert.equal(bytes.subarray(0, 4).toString('hex'), '1eb726af')
    assert.equal(Number(bytes.readBigUInt64BE(28)), 32)
    const length = Number(bytes.readBigUInt64BE(60))
    const name = bytes.subarray(68, 68 + length).toString('utf8')
    assert(fixture.deployments[0].contracts.includes(name))
    response.result = mode === 'malformed' ? '0x1234' : '0x' + (name === 'Registry' ? addresses[0] : name === 'UI' ? addresses[1] : '0x' + '0'.repeat(40)).slice(2).padStart(64, '0')
  }
  return fulfill(request, JSON.stringify(response))
}
socket.addEventListener('message', event => {
  const message = JSON.parse(event.data)
  if (message.id) {
    const request = pending.get(message.id)
    if (!request) return
    pending.delete(message.id); clearTimeout(request.timer)
    message.error ? request.reject(new Error(JSON.stringify(message.error))) : request.resolve(message.result)
  } else if (message.method === 'Fetch.requestPaused') void intercept(message.params).catch(error => { interceptionError = error })
})
async function evaluate(expression) {
  const result = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  assert(!result.exceptionDetails, JSON.stringify(result.exceptionDetails))
  return result.result.value
}
async function until(expression) {
  const deadline = Date.now() + 25000
  while (Date.now() < deadline) {
    if (interceptionError) throw interceptionError
    if (typeof expression === 'function' ? expression() : await evaluate(expression)) return
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error(`Readiness timed out: ${expression}; ${await evaluate('document.body.innerText')}`)
}
async function navigate() { await call('Page.navigate', { url: `${page}?check=${Date.now()}` }); await until('document.querySelector(".rpc-controls")') }
const working = 'document.querySelector(".rpc-controls [role=status]")?.textContent === "✓"'
try {
  ;({ targetId } = await call('Target.createTarget', { url: 'about:blank', background: true }))
  ;({ sessionId } = await call('Target.attachToTarget', { targetId, flatten: true }, undefined))
  await call('Page.enable'); await call('Runtime.enable'); await call('Network.enable')
  await call('Network.setCacheDisabled', { cacheDisabled: true })
  await call('Fetch.enable', { patterns: [{ urlPattern: page + '*' }, { urlPattern: 'https://numpde.github.io/dapp32/site.css' }, { urlPattern: catalogURL }, { urlPattern: publicRPC + '*' }, { urlPattern: customRPC + '*' }] })
  await navigate(); await until(working)
  assert.deepEqual(await evaluate('[...document.querySelectorAll(".address-controls code")].map(n=>n.textContent)'), [host, ...addresses])
  assert.equal(await evaluate('document.querySelectorAll(".contracts > div").length'), 4)
  assert(await evaluate('[...document.querySelectorAll(".contracts > div")].every(row => (row.querySelector("dt a")?.href ?? null) === (row.querySelector("dd a")?.href ?? null))'), 'Contract names and addresses must link to the same explorer page; unbound names must not link')
  assert.match(await evaluate('document.querySelector(".contracts").textContent'), /Not bound/)
  assert.equal(await evaluate('document.querySelector(".rpc-controls select").options.length'), 2, 'Key templates must not be selectable')
  assert.equal(await evaluate('document.querySelector(".rpc-controls select").selectedOptions[0].textContent'), 'rpc.fixture.test')
  for (const width of [1280, 320]) {
    await call('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: false })
    assert(await evaluate('document.documentElement.scrollWidth<=document.documentElement.clientWidth'), `Overflow at ${width}`)
  }
  for (mode of ['fail', 'wrong-chain', 'malformed']) {
    observed = []; await navigate(); await until('document.querySelector(".deployment [role=alert]")')
    assert.equal(await evaluate('document.querySelectorAll(".contracts > div").length'), 1, 'No stale or partial binding rows')
    assert(await evaluate('[...document.querySelectorAll(".deployment a")].some(a=>a.textContent==="Open app →")'))
    if (mode === 'wrong-chain') assert.deepEqual(observed.map(request => request.method), ['eth_chainId'])
  }
  mode = 'success'; await evaluate('[...document.querySelectorAll(".deployment button")].find(b=>b.textContent==="Retry contract lookup").click()'); await until(working)
  mode = 'held'; await navigate(); await until('document.querySelector(".deployment").textContent.includes("Loading contracts")')
  await until(() => held.length > 0)
  await evaluate(`document.querySelector('.rpc-controls select').value='';document.querySelector('.rpc-controls select').dispatchEvent(new Event('change'));document.querySelector('.rpc-controls input').value=${JSON.stringify(customRPC)};document.querySelector('.rpc-controls input').dispatchEvent(new Event('input'))`)
  await until(working)
  for (const request of held) await fulfill(request, JSON.stringify({ jsonrpc: '2.0', id: 1, error: { code: -32000, message: 'Late failure' } })).catch(() => {})
  held = []
  assert.equal(await evaluate('document.querySelectorAll(".deployment [role=alert]").length'), 0)
  assert(await evaluate(working), 'Stale failure must not erase current success')
  assert(observed.some(request => request.url === customRPC))
  await evaluate(`Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async value=>{window.copiedAddress=value}}});document.querySelector('.copy-address').click()`)
  await until('window.copiedAddress'); assert.equal(await evaluate('window.copiedAddress'), host)
  await evaluate(`Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async()=>{throw new Error('denied')}}});document.querySelector('.copy-address').click()`)
  await until('document.querySelector(".copy-recovery input")'); assert.equal(await evaluate('document.querySelector(".copy-recovery input").value'), host)
  failData = true; await call('Page.navigate', { url: page + '?failure' }); await until('document.querySelector("#retry")?.hidden===false')
  failData = false; mode = 'success'; await evaluate('document.querySelector("#retry").click()'); await until(working)
  fixture.deployments[0].rpcUrl = customRPC
  await navigate(); await until(working)
  assert.equal(await evaluate('document.querySelector(".rpc-controls select").value'), customRPC)
  delete fixture.deployments[0].rpcUrl
  // No catalog endpoint: render the app/root and allow a custom endpoint without a failed automatic request.
  catalog.fixture.services = {}; observed = []; await navigate()
  assert.equal(await evaluate('document.querySelector(".rpc-controls input").hidden'), false)
  assert.equal(observed.length, 0)
  await evaluate(`document.querySelector('.rpc-controls input').value=${JSON.stringify(customRPC)};document.querySelector('.rpc-controls input').dispatchEvent(new Event('input'))`); await until(working)
  console.log(JSON.stringify({ fixtures: true, pinnedReads: true, noWrites: true, wrongChainRejected: true, failureAndRetry: true, staleCompletionDiscarded: true, customWithoutCatalog: true, widths: [1280, 320], mockCopy: true, nativeClipboardTested: false }))
  if (process.env.LIVE_RPC === '1') {
    live = true; await navigate(); await until(working)
    console.log(JSON.stringify({ liveReadOnlyRPC: true, contracts: await evaluate('document.querySelectorAll(".contracts > div").length'), addresses: await evaluate('[...document.querySelectorAll(".address-controls code")].map(n=>n.textContent)') }))
  }
} finally {
  if (targetId) await call('Target.closeTarget', { targetId }, undefined)
  socket.close()
}
