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

const checkDeadline = Date.now() + 180000
const timeout = AbortSignal.timeout(180000)
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
    reject(new Error('CDP WebSocket did not open within 180 seconds'))
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
const transactionRequests = []
let intercept
const heldRequests = []
let alteredCamBody
ws.addEventListener('message', async event => {
  const message = JSON.parse(event.data)
  if (message.id) {
    const request = pending.get(message.id)
    if (request) {
      pending.delete(message.id)
      clearTimeout(request.timer)
      message.error ? request.reject(new Error(`${request.method}: ${message.error.message}`)) : request.resolve(message.result)
    }
    return
  }
  if (message.sessionId !== sessionId) return
  const { method, params } = message
  if (!params) return
  if (method === 'Network.requestWillBeSent') {
    requested.set(params.requestId, params.request.url)
    if (params.request.url === cam.href) rootRequestId = params.requestId
    if (params.request.url === rpc.href && /eth_send(Raw)?Transaction/.test(params.request.postData || '')) transactionRequests.push(params.requestId)
  }
  if (method === 'Network.responseReceived') statuses.set(params.requestId, params.response.status)
  if (method === 'Network.loadingFinished' && statuses.get(params.requestId) >= 200 && statuses.get(params.requestId) < 300) loaded.add(requested.get(params.requestId))
  if (method === 'Network.loadingFailed') failures.push({ url: requested.get(params.requestId), reason: params.errorText })
  if (method === 'Runtime.exceptionThrown') exceptions.push(params.exceptionDetails.text)
  if (method === 'Runtime.consoleAPICalled' && params.type === 'error') consoleErrors.push(params.args.map(arg => String(arg.value === undefined ? arg.description : arg.value)).join(' '))
  if (method === 'Fetch.requestPaused') {
    try {
      if (intercept === 'hold') {
        heldRequests.push(params.requestId)
      } else if (intercept === 'tamper') {
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
    const target = session ? `owned target ${targetId}, session ${session}` : 'browser session'
    const operation = method === 'Input.dispatchMouseEvent' ? `${method}(${params.type})` : method
    const waitMs = Math.min(10000, Math.max(1, checkDeadline - Date.now()))
    const timer = setTimeout(() => {
      pending.delete(id)
      reject(new Error(`CDP ${operation} on ${target} did not respond within ${waitMs} ms (request ${id})`))
    }, waitMs)
    pending.set(id, { resolve, reject, timer, method: operation })
    try {
      ws.send(JSON.stringify({ id, method, params, ...(session ? { sessionId: session } : {}) }))
    } catch (error) {
      pending.delete(id)
      clearTimeout(timer)
      reject(error)
    }
  })
}
timeout.addEventListener('abort', () => {
  for (const request of pending.values()) {
    clearTimeout(request.timer)
    request.reject(new Error(`CDP check exceeded 180 seconds during ${request.method}`))
  }
  pending.clear()
}, { once: true })
ws.addEventListener('close', () => {
  for (const request of pending.values()) {
    clearTimeout(request.timer)
    request.reject(new Error(`CDP socket closed during ${request.method}`))
  }
  pending.clear()
})
async function evaluate(expression) {
  const result = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessionId)
  assert(!result.exceptionDetails, `browser expression failed: ${result.exceptionDetails?.text}`)
  return result.result.value
}
async function field(name) {
  return evaluate(`document.querySelector('input[name=${JSON.stringify(name)}]')?.value`)
}
async function enter(name, value) {
  const found = await evaluate(`(() => { const input = document.querySelector('input[name=${JSON.stringify(name)}]'); if (!input) return false; input.scrollIntoView({block:'center'}); input.focus(); input.select(); return true })()`)
  assert(found, `missing ${name} field`)
  await call('Input.insertText', { text: value }, sessionId)
  await waitFor(async state => (await field(name)) === value, `${name} edit`)
}
async function clickButton(label) {
  if (label !== 'Prepare funded agreement') {
    const clicked = await evaluate(`(() => { const button = [...document.querySelectorAll('button')].find(button => button.textContent.trim() === ${JSON.stringify(label)}); if (!button || button.matches(':disabled')) return false; button.click(); return true })()`)
    assert(clicked, `${label} button is absent or disabled`)
    return
  }
  // Scrolling only positions the button; the assertion below requires native
  // pointer activation on the visible button before product feedback is checked.
  const point = await evaluate(`(() => { const button = [...document.querySelectorAll('button')].find(button => button.textContent.trim() === ${JSON.stringify(label)}); if (!button || button.matches(':disabled')) return null; button.scrollIntoView({block:'center'}); const r = button.getBoundingClientRect(); const x=r.left+r.width/2,y=r.top+r.height/2; return {x,y,width:innerWidth,height:innerHeight,hit:document.elementFromPoint(x,y)?.textContent?.trim()} })()`)
  assert(point && point.x >= 0 && point.x < point.width && point.y >= 0 && point.y < point.height && point.hit === label, `${label} is not the pointer target in the viewport`)
  await evaluate(`(() => { const button = [...document.querySelectorAll('button')].find(button => button.textContent.trim() === ${JSON.stringify(label)}); window.__browserCheckEvents = []; button.addEventListener('click', () => window.__browserCheckEvents.push('click'), {capture:true, once:true}) })()`)
  await call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x, y: point.y, button: 'none', buttons: 0 }, sessionId)
  await call('Input.dispatchMouseEvent', { type: 'mousePressed', x: point.x, y: point.y, button: 'left', buttons: 1, clickCount: 1 }, sessionId)
  await call('Input.dispatchMouseEvent', { type: 'mouseReleased', x: point.x, y: point.y, button: 'left', buttons: 0, clickCount: 1 }, sessionId)
  const events = await evaluate('window.__browserCheckEvents')
  assert(events.includes('click'), `${label} received no browser click (${events.join(', ')})`)
}
async function feedback(kind) {
  return evaluate(`(() => { const node = ${kind === 'notice' ? "[...document.querySelectorAll('.notice')].at(-1)" : "document.querySelector('.prepared-call')"}; if (!node) return null; const r=node.getBoundingClientRect(); return {text:node.innerText, role:node.getAttribute('role'), top:r.top,bottom:r.bottom,height:innerHeight, focus:node.contains(document.activeElement), active:document.activeElement?.tagName} })()`)
}
async function waitFor(predicate, label, failOnViewerError) {
  let lastState
  for (let count = 0; count < 80 && !timeout.aborted; count++) {
    const state = await evaluate(`({heading:document.querySelector('h1')?.textContent, text:document.body?.innerText, width:document.documentElement.scrollWidth, viewport:innerWidth})`)
    lastState = state
    if (await predicate(state)) return state
    if (failOnViewerError && state.text?.includes('Cannot load viewer')) throw new Error(`viewer failed before ${label}: ${state.text}`)
    await new Promise(resolve => setTimeout(resolve, 250))
  }
  const details = await evaluate(`({notices:[...document.querySelectorAll('.notice')].map(node=>node.innerText), agreementId:document.querySelector('input[name=agreementId]')?.value, agreementRef:document.querySelector('input[name=agreementRef]')?.value, buttons:[...document.querySelectorAll('button')].map(node=>[node.textContent.trim(),node.disabled])})`)
  throw new Error(`timed out waiting for ${label}; ${JSON.stringify(details)}; last view: ${JSON.stringify(lastState?.text?.slice(-400))}`)
}
async function assertNarrowUi(label) {
  await call('Emulation.setDeviceMetricsOverride', { width: 375, height: 800, deviceScaleFactor: 1, mobile: true }, sessionId)
  const layout = await evaluate(`(() => { const ui = document.querySelector('.ui'); const meta = ui?.querySelector('.ui-meta'); const uri = meta?.lastElementChild; return { page: document.documentElement.scrollWidth, viewport: innerWidth, meta: meta?.scrollWidth, metaClient: meta?.clientWidth, uri: uri?.scrollWidth, uriClient: uri?.clientWidth, uriText: uri?.textContent, uriRight: uri?.getBoundingClientRect().right, uiRight: ui?.getBoundingClientRect().right } })()`)
  assert.equal(layout.uriText, new URL('./ui.json', cam).href, `${label}: UI URI is missing`)
  assert(layout.page <= layout.viewport, `${label}: document overflows at 375px`)
  assert(layout.meta <= layout.metaClient && layout.uri <= layout.uriClient && layout.uriRight <= layout.uiRight, `${label}: UI URI is clipped at 375px`)
}
const regressions = []
async function browserCase(name, run) {
  try { await run(); console.log(`${name}: passed`) }
  catch (error) { regressions.push(`${name}: ${error.message}`); console.error(`${name}: ${error.message}`) }
}
async function freshForm() {
  await call('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false }, sessionId)
  await openViewer(viewer.href)
  await waitFor(async state => state.heading === 'Native-asset escrow' && (await field('agreementRef')) !== undefined, 'fresh create form', true)
}
async function openViewer(location) {
  await call('Page.navigate', { url: 'about:blank' }, sessionId)
  await waitFor(async () => (await evaluate('location.href')) === 'about:blank', 'blank reset')
  await call('Page.navigate', { url: location }, sessionId)
}
let targetId
try {
  targetId = (await call('Target.createTarget', { url: 'about:blank' }, undefined)).targetId
  sessionId = (await call('Target.attachToTarget', { targetId, flatten: true }, undefined)).sessionId
  await call('Page.enable', {}, sessionId)
  await call('Page.bringToFront', {}, sessionId)
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
  assert.deepEqual(failures.filter(failure => failure.reason !== 'net::ERR_ABORTED' || !loaded.has(failure.url)), [], 'unexpected network failures')
  assert.deepEqual(exceptions, [], 'browser exceptions')
  assert.deepEqual(consoleErrors, [], 'browser console errors')
  await assertNarrowUi('Escrow root')
  await evaluate(`document.querySelectorAll('button') && [...document.querySelectorAll('button')].find(button => button.textContent.includes('View account credit'))?.click()`)
  await waitFor(state => state.text.includes('Withdrawable amount in wei'), 'account credit view', false)
  await assertNarrowUi('account credit')

  await browserCase('known agreement ID without create inputs', async () => {
    await freshForm()
    const knownId = `0x${'ab'.repeat(32)}`
    await enter('agreementId', knownId)
    await clickButton('Open agreement')
    await waitFor(state => state.text.includes('No agreement is stored for this identifier.'), 'known ID lookup')
    assert((await evaluate('document.body.innerText')).includes(knownId), 'lookup did not show the requested agreement ID')
  })

  await browserCase('initial read fragment, refresh, and exact lookup default', async () => {
    const id = `0x${'ac'.repeat(32)}`
    const linked = new URL(viewer)
    linked.hash = new URLSearchParams({ route: 'agreement', inputs: JSON.stringify({ agreementId: id }) }).toString()
    await openViewer(linked.href)
    await waitFor(state => state.text.includes('No agreement is stored for this identifier.'), 'initial linked agreement', true)
    assert.equal(await field('agreementId'), id, 'selected ID was not supplied to the lookup draft')
    assert.equal(await field('agreementRef'), undefined, 'initial read link rendered a creation draft')
    assert.equal(await evaluate("[...document.querySelectorAll('button')].find(button => button.textContent.trim() === 'Back')?.disabled"), true, 'initial direct link created phantom history')
    const committed = await evaluate('location.href')
    const loader = (await call('Page.getFrameTree', {}, sessionId)).frameTree.frame.loaderId
    await call('Page.reload', {}, sessionId)
    await waitFor(async () => (await call('Page.getFrameTree', {}, sessionId)).frameTree.frame.loaderId !== loader, 'linked refresh document')
    await waitFor(state => state.text.includes('No agreement is stored for this identifier.'), 'linked agreement refresh', true)
    assert.equal(await field('agreementId'), id)
    assert.equal(await evaluate('location.href'), committed)
    assert.equal(transactionRequests.length, 0, 'opening a read link requested a transaction')
  })

  await browserCase('URL follows successful reads, not edited or rejected lookup drafts', async () => {
    await freshForm()
    const first = `0x${'ad'.repeat(32)}`
    await enter('agreementId', first)
    await clickButton('Open agreement')
    await waitFor(state => state.text.includes('No agreement is stored for this identifier.'), 'lookup URL synchronization')
    const committed = new URL(await evaluate('location.href'))
    const fragment = new URLSearchParams(committed.hash.slice(1))
    assert.equal(fragment.get('route'), 'agreement')
    assert.equal(fragment.get('agreementId'), first)
    assert.equal(fragment.has('inputs'), false, 'string inputs retained a JSON envelope')
    const second = `0x${'ae'.repeat(32)}`
    await enter('agreementId', second)
    assert.equal(await evaluate('location.href'), committed.href, 'editing changed the selected agreement URL')
    await enter('agreementId', 'not-an-identifier')
    await clickButton('Open agreement')
    await waitFor(async () => (await feedback('notice'))?.role === 'alert' && !await evaluate('document.querySelector(".elements")?.disabled'), 'rejected lookup')
    assert.equal(await evaluate('location.href'), committed.href, 'failed lookup changed the committed URL')
    assert.equal(await field('agreementId'), 'not-an-identifier', 'failed lookup discarded correction input')
    assert((await evaluate('document.body.innerText')).includes(first), 'failed lookup changed the loaded agreement')
  })

  await browserCase('fragment navigation and clearing use ordinary reads and viewer Back', async () => {
    await freshForm()
    await enter('agreementRef', 'hash-back-draft')
    await evaluate(`location.hash = new URLSearchParams({ route: 'accountCredit', inputs: '{}' }).toString()`)
    await waitFor(state => state.text.includes('Withdrawable amount in wei'), 'live fragment credit navigation')
    await clickButton('Back')
    await waitFor(async () => (await field('agreementRef')) === 'hash-back-draft', 'fragment navigation Back draft')
    const returned = new URLSearchParams(new URL(await evaluate('location.href')).hash.slice(1))
    assert.equal(returned.get('route'), 'createAgreementForm')
    await evaluate(`location.hash = new URLSearchParams({ route: 'accountCredit', inputs: '{}' }).toString()`)
    await waitFor(state => state.text.includes('Withdrawable amount in wei'), 'credit before clearing fragment')
    await evaluate("location.hash = ''")
    await waitFor(async () => (await field('agreementRef')) !== undefined, 'clear fragment manifest entry')
    const entry = new URLSearchParams(new URL(await evaluate('location.href')).hash.slice(1))
    assert.equal(entry.get('route'), 'createAgreementForm')
    assert.equal(transactionRequests.length, 0, 'fragment navigation requested a transaction')
  })

  await browserCase('a busy fragment request preserves the original pending read', async () => {
    await freshForm()
    await enter('agreementRef', 'pending-link-draft')
    const committed = await evaluate('location.href')
    intercept = 'hold'
    await call('Fetch.enable', { patterns: [{ urlPattern: rpc.href, requestStage: 'Request' }] }, sessionId)
    try {
      await evaluate(`location.hash = new URLSearchParams({ route: 'accountCredit', inputs: '{}' }).toString()`)
      await waitFor(() => heldRequests.length > 0, 'paused credit read')
      await evaluate(`location.hash = new URLSearchParams({ route: 'agreement', inputs: '{}' }).toString()`)
      await waitFor(async () => (await evaluate('location.href')) === committed && (await feedback('notice'))?.text.includes('Finish the current operation'), 'busy link rollback')
      assert.equal(await field('agreementRef'), 'pending-link-draft')
      for (const requestId of heldRequests.splice(0)) await call('Fetch.continueRequest', { requestId }, sessionId)
      await call('Fetch.disable', {}, sessionId)
      intercept = undefined
      await waitFor(state => state.text.includes('Withdrawable amount in wei'), 'original credit read commits')
      assert.equal(new URLSearchParams(new URL(await evaluate('location.href')).hash.slice(1)).get('route'), 'accountCredit')
      await clickButton('Back')
      await waitFor(async () => (await field('agreementRef')) === 'pending-link-draft', 'pending read Back draft')
      assert.equal(transactionRequests.length, 0, 'busy fragment requested a transaction')
    } finally {
      for (const requestId of heldRequests.splice(0)) await call('Fetch.continueRequest', { requestId }, sessionId)
      await call('Fetch.disable', {}, sessionId)
      intercept = undefined
    }
  })

  await browserCase('failed fragment requests restore the committed URL and preserve draft', async () => {
    await freshForm()
    await enter('agreementRef', 'malformed-link-draft')
    const committed = await evaluate('location.href')
    for (const request of [
      { route: 'missing-route', inputs: '{}' },
      { route: 'createAgreement', inputs: '{}' },
      { route: 'agreement', inputs: '{}' },
      { route: 'agreement', inputs: '{"agreementId":1}' },
      { route: 'agreement', inputs: 'null' },
    ]) {
      await evaluate(`location.hash = new URLSearchParams(${JSON.stringify(request)}).toString()`)
      await waitFor(async () => (await evaluate('location.href')) === committed && (await feedback('notice'))?.role === 'alert' && !await evaluate('document.querySelector(".elements")?.disabled'), 'rejected fragment restored URL')
      assert.equal(await field('agreementRef'), 'malformed-link-draft', 'failed link changed the current draft')
    }
    assert.equal(transactionRequests.length, 0, 'failed fragment requested a transaction')
  })

  await browserCase('initial write fragments fail without preparing a transaction', async () => {
    const linked = new URL(viewer)
    linked.hash = new URLSearchParams({ route: 'createAgreement', inputs: '{}' }).toString()
    await openViewer(linked.href)
    await waitFor(state => state.text.includes('Cannot load viewer'), 'initial write rejection')
    assert((await evaluate('document.body.innerText')).includes('must be declared as read'))
    assert.equal(await evaluate('document.querySelectorAll(".prepared-call").length'), 0)
    assert.equal(transactionRequests.length, 0, 'initial write fragment requested a transaction')
  })

  const draft = {
    agreementRef: 'browser-draft-check',
    contractor: '0x1111111111111111111111111111111111111111',
    arbitrator: '0x2222222222222222222222222222222222222222',
    amount: '42',
    acceptanceDuration: '3600',
    workDuration: '7200',
    reviewDuration: '3600',
    arbitrationDuration: '3600',
    termsUri: 'https://example.test/terms',
    termsDigest: `0x${'ab'.repeat(32)}`,
  }
  async function fillDraft() {
    await freshForm()
    for (const [name, value] of Object.entries(draft)) await enter(name, value)
  }
  await browserCase('draft survives lookup, credit, and Back twice', async () => {
    await fillDraft()
    await clickButton('Look up agreement')
    await waitFor(state => state.text.includes('No agreement is stored for this identifier.'), 'reference lookup')
    await clickButton('View account credit')
    await waitFor(state => state.text.includes('Withdrawable amount in wei'), 'credit from lookup')
    await clickButton('Back')
    await waitFor(state => state.text.includes('No agreement is stored for this identifier.'), 'Back to lookup')
    await clickButton('Back')
    await waitFor(async () => (await field('agreementRef')) !== undefined, 'Back to draft')
    for (const [name, value] of Object.entries(draft)) assert.equal(await field(name), value, `${name} draft was lost`)
  })

  // Start at the bottom of the long form; feedback must arrive where the user is.
  await browserCase('prepare rejection feedback', async () => {
    await fillDraft()
    await enter('contractor', '0x0000000000000000000000000000000000000000')
    await clickButton('Prepare funded agreement')
    await waitFor(async () => /InvalidPartyConfiguration/.test((await feedback('notice'))?.text || ''), 'decoded prepare rejection')
    const rejected = await feedback('notice')
    assert(rejected.role === 'alert' || rejected.role === 'status', 'prepare rejection is not announced')
    assert(rejected.top >= 0 && rejected.top < rejected.height && rejected.bottom > 0, 'prepare rejection is outside the viewport')
    assert.equal(await field('agreementRef'), draft.agreementRef, 'prepare rejection discarded draft')
    assert.equal(await field('amount'), draft.amount, 'prepare rejection discarded amount')
  })

  await browserCase('repeated rejection and ordinary editing focus', async () => {
    await fillDraft()
    await enter('contractor', '0x0000000000000000000000000000000000000000')
    await clickButton('Prepare funded agreement')
    await waitFor(async () => /InvalidPartyConfiguration/.test((await feedback('notice'))?.text || ''), 'first rejection')
    await enter('amount', '43')
    assert.equal(await evaluate("document.activeElement?.getAttribute('name')"), 'amount', 'editing stole focus from amount')
    await clickButton('Prepare funded agreement')
    await waitFor(async () => (await feedback('notice'))?.focus === true, 'repeat rejection focus')
    assert.equal(await field('amount'), '43', 'repeat rejection discarded edit')
  })

  await browserCase('prepared review feedback', async () => {
    await fillDraft()
    await clickButton('Prepare funded agreement')
    await waitFor(async () => Boolean((await feedback('prepared'))?.text?.includes('Prepared contract call')), 'prepared review')
    const prepared = await feedback('prepared')
    assert(prepared.top >= 0 && prepared.top < prepared.height && prepared.bottom > 0, 'prepared review is outside the viewport')
    assert(prepared.focus, 'prepared review did not receive accessible focus')
    assert.equal(await field('agreementRef'), draft.agreementRef, 'prepare discarded draft')
    assert.equal(transactionRequests.length, 0, 'prepare sent a transaction before explicit wallet confirmation')
  })

  await browserCase('discard prepared review preserves draft', async () => {
    await fillDraft()
    await clickButton('Prepare funded agreement')
    await waitFor(async () => Boolean((await feedback('prepared'))?.text?.includes('Prepared contract call')), 'review before discard')
    await clickButton('Discard prepared call')
    await waitFor(async () => await evaluate("document.querySelector('.prepared-call') === null && document.activeElement === document.querySelector('.ui')"), 'discarded review and current-view focus')
    for (const [name, value] of Object.entries(draft)) assert.equal(await field(name), value, `${name} draft changed after discard`)
    assert.equal(transactionRequests.length, 0, 'discard sent a transaction')
  })

  await browserCase('explicit new agreement clears draft', async () => {
    await fillDraft()
    await clickButton('Look up agreement')
    await waitFor(state => state.text.includes('No agreement is stored for this identifier.'), 'lookup before new')
    await clickButton('Create another agreement')
    await waitFor(async () => (await field('agreementRef')) !== undefined, 'explicit new agreement')
    assert.equal(await field('agreementRef'), '', 'explicit new agreement retained the old reference')
    assert.equal(await field('amount'), '0', 'explicit new agreement retained the old amount')
  })

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
  assert.deepEqual(regressions, [], 'browser workflow regressions')
} finally {
  if (intercept && !timeout.aborted) await call('Fetch.disable', {}, sessionId).catch(error => console.error(`Fetch.disable: ${error.message}`))
  if (targetId) {
    let closed = false
    if (!timeout.aborted && ws.readyState === WebSocket.OPEN) {
      try {
        const result = await call('Target.closeTarget', { targetId }, undefined)
        closed = result.success === true
      } catch (error) {
        console.error(`CDP owned target close failed: ${error.message}`)
      }
    }
    if (!closed) {
      try {
        const response = await fetch(new URL(`/json/close/${targetId}`, cdp), { signal: AbortSignal.timeout(2000) })
        assert(response.ok, `HTTP ${response.status}`)
      } catch (error) {
        console.error(`HTTP owned target close failed: ${error.message}`)
      }
    }
  }
  ws.close()
}
