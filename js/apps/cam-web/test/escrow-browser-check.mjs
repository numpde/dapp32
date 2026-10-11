// Live publication smoke. CDP controls only the target created below.
import assert from 'node:assert/strict'

const loopback = new Set(['127.0.0.1', 'localhost', '[::1]'])
function url(value, name, protocols, local) {
  const parsed = new URL(value)
  assert(protocols.includes(parsed.protocol), `${name} must use ${protocols.join(' or ')}`)
  assert(!parsed.username && !parsed.password, `${name} must not contain credentials`)
  if (local) assert(loopback.has(parsed.hostname), `${name} must use loopback`)
  return parsed
}

const cdp = url(process.env.CDP_ORIGIN, 'CDP_ORIGIN', ['http:'], true)
assert(cdp.pathname === '/' && !cdp.search && !cdp.hash, 'CDP_ORIGIN must be an origin')
const viewer = url(process.env.VIEWER_URL, 'VIEWER_URL', ['http:'], true)
const cam = url(process.env.EXPECTED_CAM_URI, 'EXPECTED_CAM_URI', ['http:', 'https:'], false)
const hash = process.env.EXPECTED_CAM_HASH
assert(/^0x[0-9a-fA-F]{64}$/.test(hash) && !/^0x0+$/.test(hash), 'EXPECTED_CAM_HASH must be a nonzero bytes32')
const host = viewer.searchParams.get('host')
const rpc = url(viewer.searchParams.get('rpcUrl'), 'viewer rpcUrl', ['http:'], true)
assert(/^0x[0-9a-fA-F]{40}$/.test(host), 'viewer host must be an address')
assert(viewer.searchParams.get('chainId') && viewer.searchParams.get('account'), 'viewer URL needs chainId and account')

const timeout = AbortSignal.timeout(30000)
async function jsonFetch(location, options) {
  const response = await fetch(location, { ...options, signal: timeout })
  assert(response.ok, `${location} returned HTTP ${response.status}`)
  return response.json()
}
const rpcCall = async selector => {
  const reply = await jsonFetch(rpc, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to: host, data: selector }, 'latest'] }),
  })
  assert(!reply.error && /^0x[0-9a-fA-F]+$/.test(reply.result), `cam root eth_call failed: ${JSON.stringify(reply.error)}`)
  return reply.result
}

// These are keccak function selectors for camURI() and camHash().
const onchainURI = await rpcCall('0x82cf13be')
const uriBytes = Buffer.from(onchainURI.slice(2), 'hex')
const uriOffset = Number(BigInt(`0x${uriBytes.subarray(0, 32).toString('hex')}`))
const uriLength = Number(BigInt(`0x${uriBytes.subarray(uriOffset, uriOffset + 32).toString('hex')}`))
assert(uriOffset === 32 && uriLength > 0 && uriLength <= 4096 && uriBytes.length >= uriOffset + 32 + uriLength, 'invalid camURI result')
assert.equal(uriBytes.subarray(uriOffset + 32, uriOffset + 32 + uriLength).toString(), cam.href, 'onchain CAM URI differs')
assert.equal((await rpcCall('0x81ad4c48')).toLowerCase(), hash.toLowerCase(), 'onchain CAM hash differs')

const version = await jsonFetch(new URL('/json/version', cdp), {})
const browserSocket = url(version.webSocketDebuggerUrl, 'browser CDP socket', ['ws:'], true)
assert(browserSocket.host === cdp.host, 'CDP advertised a different endpoint')
const ws = new WebSocket(browserSocket)
await new Promise((resolve, reject) => {
  function cleanup() {
    ws.removeEventListener('open', opened)
    ws.removeEventListener('error', failed)
    timeout.removeEventListener('abort', aborted)
  }
  function opened() { cleanup(); resolve() }
  function failed() {
    cleanup()
    reject(new Error('CDP WebSocket failed to open'))
    try { ws.close() } catch { /* A connecting socket can reject close. */ }
  }
  function aborted() {
    cleanup()
    try { ws.close() } catch { /* A connecting socket can reject close. */ }
    reject(new Error('CDP WebSocket did not open within 30 seconds'))
  }
  ws.addEventListener('open', opened)
  ws.addEventListener('error', failed)
  timeout.addEventListener('abort', aborted, { once: true })
  if (timeout.aborted) aborted()
})
let nextId = 0
const pending = new Map()
let sessionId
const requested = new Map()
const loaded = new Set()
const statuses = new Map()
let rootRequestId
const failures = []
const exceptions = []
const consoleErrors = []
let intercept
let alteredCamBody
ws.addEventListener('message', async event => {
  const message = JSON.parse(event.data)
  if (message.id) {
    const request = pending.get(message.id)
    if (request) { pending.delete(message.id); message.error ? request.reject(new Error(message.error.message)) : request.resolve(message.result) }
    return
  }
  if (message.sessionId !== sessionId) return
  const { method, params } = message
  if (!params) return
  if (method === 'Network.requestWillBeSent') {
    requested.set(params.requestId, params.request.url)
    if (params.request.url === cam.href) rootRequestId = params.requestId
  }
  if (method === 'Network.responseReceived') statuses.set(params.requestId, params.response.status)
  if (method === 'Network.loadingFinished' && statuses.get(params.requestId) >= 200 && statuses.get(params.requestId) < 300) loaded.add(requested.get(params.requestId))
  if (method === 'Network.loadingFailed') failures.push(`${requested.get(params.requestId)}: ${params.errorText}`)
  if (method === 'Runtime.exceptionThrown') exceptions.push(params.exceptionDetails.text)
  if (method === 'Runtime.consoleAPICalled' && params.type === 'error') consoleErrors.push(params.args.map(arg => String(arg.value === undefined ? arg.description : arg.value)).join(' '))
  if (method === 'Fetch.requestPaused') {
    try {
      if (intercept === 'tamper') {
        await call('Fetch.fulfillRequest', {
          requestId: params.requestId, responseCode: 200,
          responseHeaders: [
            { name: 'Content-Type', value: 'application/json' },
            { name: 'Access-Control-Allow-Origin', value: '*' },
          ],
          body: Buffer.from(alteredCamBody).toString('base64'),
        }, sessionId)
      } else {
        await call('Fetch.failRequest', { requestId: params.requestId, errorReason: 'Failed' }, sessionId)
      }
    } catch (error) { failures.push(`interception failed: ${error.message}`) }
  }
})
function call(method, params, session) {
  assert(!timeout.aborted, `CDP timed out during ${method}`)
  return new Promise((resolve, reject) => {
    const id = ++nextId
    pending.set(id, { resolve, reject })
    ws.send(JSON.stringify({ id, method, params, ...(session ? { sessionId: session } : {}) }))
  })
}
timeout.addEventListener('abort', () => {
  for (const request of pending.values()) request.reject(new Error('CDP check exceeded 30 seconds'))
  pending.clear()
}, { once: true })
async function evaluate(expression) {
  const result = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessionId)
  assert(!result.exceptionDetails, `browser expression failed: ${result.exceptionDetails?.text}`)
  return result.result.value
}
async function waitFor(predicate, label, failOnViewerError) {
  for (let count = 0; count < 80 && !timeout.aborted; count++) {
    const state = await evaluate(`({heading:document.querySelector('h1')?.textContent, text:document.body?.innerText, width:document.documentElement.scrollWidth, viewport:innerWidth})`)
    if (predicate(state)) return state
    if (failOnViewerError && state.text?.includes('Cannot load viewer')) throw new Error(`viewer failed before ${label}: ${state.text}`)
    await new Promise(resolve => setTimeout(resolve, 250))
  }
  throw new Error(`timed out waiting for ${label}`)
}
async function assertNarrowUi(label) {
  await call('Emulation.setDeviceMetricsOverride', { width: 375, height: 800, deviceScaleFactor: 1, mobile: true }, sessionId)
  const layout = await evaluate(`(() => { const ui = document.querySelector('.ui'); const meta = ui?.querySelector('.ui-meta'); const uri = meta?.lastElementChild; return { page: document.documentElement.scrollWidth, viewport: innerWidth, meta: meta?.scrollWidth, metaClient: meta?.clientWidth, uri: uri?.scrollWidth, uriClient: uri?.clientWidth, uriText: uri?.textContent, uriRight: uri?.getBoundingClientRect().right, uiRight: ui?.getBoundingClientRect().right } })()`)
  assert.equal(layout.uriText, new URL('./ui.json', cam).href, `${label}: UI URI is missing`)
  assert(layout.page <= layout.viewport, `${label}: document overflows at 375px`)
  assert(layout.meta <= layout.metaClient && layout.uri <= layout.uriClient && layout.uriRight <= layout.uiRight, `${label}: UI URI is clipped at 375px`)
}
let targetId
try {
  targetId = (await call('Target.createTarget', { url: 'about:blank' }, undefined)).targetId
  sessionId = (await call('Target.attachToTarget', { targetId, flatten: true }, undefined)).sessionId
  await call('Page.enable', {}, sessionId)
  await call('Runtime.enable', {}, sessionId)
  await call('Network.enable', {}, sessionId)
  await call('Page.navigate', { url: viewer.href }, sessionId)
  const ready = await waitFor(state => state.heading === 'Native-asset escrow', 'Escrow root view', true)
  assert(ready.text.includes('Agreement reference'), 'Escrow form did not render')
  const resources = [cam.href, new URL('./ui.json', cam).href, new URL('./abi/CamEscrow.json', cam).href, new URL('./abi/CamEscrowUI.json', cam).href]
  for (const resource of resources) assert(loaded.has(resource), `required CAM resource did not finish: ${resource}`)
  assert(rootRequestId, 'root CAM request was not observed')
  const rootResponse = await call('Network.getResponseBody', { requestId: rootRequestId }, sessionId)
  const rootText = Buffer.from(rootResponse.body, rootResponse.base64Encoded ? 'base64' : 'utf8').toString('utf8')
  JSON.parse(rootText)
  alteredCamBody = `${rootText}\n`
  assert.deepEqual(failures, [], 'unexpected network failures')
  assert.deepEqual(exceptions, [], 'browser exceptions')
  assert.deepEqual(consoleErrors, [], 'browser console errors')
  await assertNarrowUi('Escrow root')
  await evaluate(`document.querySelectorAll('button') && [...document.querySelectorAll('button')].find(button => button.textContent.includes('View account credit'))?.click()`)
  await waitFor(state => state.text.includes('Withdrawable amount in wei'), 'account credit view', false)
  await assertNarrowUi('account credit')

  // The same valid CAM JSON with one extra byte must fail its onchain hash.
  // Interception is restricted to this owned target's root CAM request.
  await call('Fetch.enable', { patterns: [{ urlPattern: cam.href, requestStage: 'Request' }] }, sessionId)
  intercept = 'tamper'
  await call('Page.navigate', { url: viewer.href }, sessionId)
  const tampered = await waitFor(state => state.text.includes('Cannot load viewer') && /CAM hash mismatch/i.test(state.text), 'CAM hash rejection', true)
  assert.notEqual(tampered.heading, 'Native-asset escrow', 'tampered CAM rendered as ready')
  assert(/CAM hash mismatch/i.test(tampered.text), 'tampered CAM did not report a hash mismatch')

  // A failed fetch must leave Loading and identify the URL and cause.
  intercept = 'fail'
  await call('Page.navigate', { url: viewer.href }, sessionId)
  const failed = await waitFor(state => state.text.includes('Cannot load viewer') && /Failed to fetch|net::ERR_FAILED/.test(state.text), 'failed-load explanation', false)
  assert.notEqual(failed.heading, 'Loading', 'failure left the page titled Loading')
  assert(failed.text.includes(cam.href), 'failure hid the failed resource URL')
  assert(/Failed to fetch|net::ERR_FAILED/.test(failed.text), 'failure hid the browser fetch cause')
  for (const width of [1200, 375]) {
    await call('Emulation.setDeviceMetricsOverride', { width, height: 800, deviceScaleFactor: 1, mobile: width < 500 }, sessionId)
    const layout = await evaluate(`({width:document.documentElement.scrollWidth, viewport:innerWidth, error:document.querySelector('.error')?.innerText})`)
    assert(layout.width <= layout.viewport, `failed-load page overflows at ${width}px`)
    assert(layout.error.includes(cam.href), `failed resource URL is hidden at ${width}px`)
  }
  console.log('Escrow browser publication and failed-load checks passed')
} finally {
  if (intercept && !timeout.aborted) await call('Fetch.disable', {}, sessionId).catch(error => console.error(`Fetch.disable: ${error.message}`))
  if (targetId) {
    if (timeout.aborted) {
      await fetch(new URL(`/json/close/${targetId}`, cdp), { signal: AbortSignal.timeout(2000) })
        .catch(error => console.error(`CDP target close: ${error.message}`))
    } else {
      await call('Target.closeTarget', { targetId }, undefined)
        .catch(error => console.error(`CDP target close: ${error.message}`))
    }
  }
  ws.close()
}
