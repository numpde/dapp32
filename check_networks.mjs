import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const cdp = new URL(process.env.CDP_ORIGIN)
assert(cdp.protocol === 'http:' && !cdp.username && !cdp.password, 'Use an HTTP browser debugging origin')
const pageURL = 'https://numpde.github.io/dapp32/deployment/networks/'
const html = process.env.PAGE_HTML ? await readFile(process.env.PAGE_HTML) : undefined
const version = await (await fetch(new URL('/json/version', cdp), { signal: AbortSignal.timeout(5000) })).json()
assert.equal(new URL(version.webSocketDebuggerUrl).host, cdp.host)
const socket = new WebSocket(version.webSocketDebuggerUrl)
await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true })
  socket.addEventListener('error', reject, { once: true })
  setTimeout(() => reject(new Error('Browser connection timed out')), 5000).unref()
})
let nextId = 0
const pending = new Map()
let sessionId
let targetId
let failCatalog = false
let interceptionError
socket.addEventListener('message', event => {
  const message = JSON.parse(event.data)
  if (message.id) {
    const request = pending.get(message.id)
    if (!request) return
    pending.delete(message.id)
    clearTimeout(request.timer)
    if (message.error) request.reject(new Error(JSON.stringify(message.error)))
    else request.resolve(message.result)
  } else if (message.method === 'Fetch.requestPaused') {
    const request = message.params
    const response = request.resourceType === 'Document' && html !== undefined
      ? { requestId: request.requestId, responseCode: 200, responseHeaders: [{ name: 'Content-Type', value: 'text/html; charset=utf-8' }], body: html.toString('base64') }
      : { requestId: request.requestId, responseCode: 503, responseHeaders: [{ name: 'Access-Control-Allow-Origin', value: '*' }], body: '' }
    void call('Fetch.fulfillRequest', response).catch(error => { interceptionError = error })
  }
})
function call(method, params = {}, session = sessionId) {
  const id = ++nextId
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method} timed out`)) }, 10000)
    pending.set(id, { resolve, reject, timer })
    socket.send(JSON.stringify({ id, method, params, ...(session ? { sessionId: session } : {}) }))
  })
}
async function evaluate(expression) {
  const result = await call('Runtime.evaluate', { expression, returnByValue: true })
  assert(!result.exceptionDetails, JSON.stringify(result.exceptionDetails))
  return result.result.value
}
try {
  ;({ targetId } = await call('Target.createTarget', { url: 'about:blank' }))
  ;({ sessionId } = await call('Target.attachToTarget', { targetId, flatten: true }, undefined))
  await call('Page.enable')
  await call('Runtime.enable')
  await call('Network.enable')
  await call('Network.setCacheDisabled', { cacheDisabled: true })
  for (failCatalog of [false, true]) {
    const patterns = []
    if (html !== undefined) patterns.push({ urlPattern: `${pageURL}*`, resourceType: 'Document' })
    if (failCatalog) patterns.push({ urlPattern: 'https://raw.githubusercontent.com/*rpc-catalog.json*' })
    if (patterns.length) await call('Fetch.enable', { patterns })
    else await call('Fetch.disable')
    await call('Page.navigate', { url: `${pageURL}?browser-check=${Date.now()}` })
    let state
    const deadline = Date.now() + 20000
    do {
      if (interceptionError) throw interceptionError
      state = await evaluate(`({status:document.querySelector('#load-status')?.textContent,rows:document.querySelectorAll('tbody tr').length,visible:document.querySelector('#reference')?.hidden===false,pickers:document.querySelectorAll('input[type=file],#open-catalog').length})`)
      if (state.status?.startsWith('Cannot load') || state.visible) break
      await new Promise(resolve => setTimeout(resolve, 100))
    } while (Date.now() < deadline)
    assert.equal(state.pickers, 0, 'The networks page must never offer a catalog picker')
    if (failCatalog) {
      assert.match(state.status, /Cannot load.*HTTP 503/)
      assert.equal(state.visible, false)
    } else {
      assert(state.visible && state.rows > 0, `Catalog must load without user input: ${JSON.stringify(state)}`)
      assert.match(state.status, /Testnets shown/)
      console.log(`Catalog loaded automatically: ${state.status}; no picker`)
    }
  }
  console.log('Catalog failure reports an error without asking for a file')
} finally {
  if (targetId) await call('Target.closeTarget', { targetId }, undefined)
  socket.close()
}
