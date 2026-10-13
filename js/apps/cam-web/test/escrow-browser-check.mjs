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
const completedNetworkRequests = new Set()
const statuses = new Map()
let rootRequestId
const failures = []
const exceptions = []
const consoleErrors = []
const transactionRequests = []
let intercept
const heldRequests = []
const heldNetworkRequests = new Map()
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
  if (method === 'Network.loadingFinished') {
    completedNetworkRequests.add(params.requestId)
    if (statuses.get(params.requestId) >= 200 && statuses.get(params.requestId) < 300) loaded.add(requested.get(params.requestId))
  }
  if (method === 'Network.loadingFailed') failures.push({ url: requested.get(params.requestId), reason: params.errorText })
  if (method === 'Runtime.exceptionThrown') exceptions.push(params.exceptionDetails.text)
  if (method === 'Runtime.consoleAPICalled' && params.type === 'error') consoleErrors.push(params.args.map(arg => String(arg.value === undefined ? arg.description : arg.value)).join(' '))
  if (method === 'Fetch.requestPaused') {
    try {
      if (intercept === 'hold') {
        heldRequests.push(params.requestId)
        heldNetworkRequests.set(params.requestId, params.networkId)
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
  if (label !== 'Prepare creation transaction') {
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
    const state = await evaluate(`(()=>{const body=document.body;const root=document.documentElement;if(body===null||root===null)return null;return {heading:document.querySelector('h1')?.textContent,text:body.innerText,width:root.scrollWidth,viewport:innerWidth};})()`)
    lastState = state
    if (state !== null) {
      if (await predicate(state)) return state
      if (failOnViewerError && state.text.includes('Cannot load viewer')) throw new Error(`viewer failed before ${label}: ${state.text}`)
    }
    await new Promise(resolve => setTimeout(resolve, 250))
  }
  const details = await evaluate(`({notices:[...document.querySelectorAll('.notice')].map(node=>node.innerText), agreementId:document.querySelector('input[name=agreementId]')?.value, agreementRef:document.querySelector('input[name=agreementRef]')?.value, buttons:[...document.querySelectorAll('button')].map(node=>[node.textContent.trim(),node.disabled])})`)
  throw new Error(`timed out waiting for ${label}; ${JSON.stringify(details)}; last view: ${JSON.stringify(lastState?.text?.slice(-400))}`)
}
async function assertNarrowUi(label, width) {
  await call('Emulation.setDeviceMetricsOverride', { width, height: 800, deviceScaleFactor: 1, mobile: width < 500 }, sessionId)
  const layout = await evaluate(`(() => { const ui = document.querySelector('.ui'); const meta = ui?.querySelector('.ui-meta'); const uri = meta?.lastElementChild; return { page: document.documentElement.scrollWidth, viewport: innerWidth, meta: meta?.scrollWidth, metaClient: meta?.clientWidth, uri: uri?.scrollWidth, uriClient: uri?.clientWidth, uriText: uri?.textContent, uriRight: uri?.getBoundingClientRect().right, uiRight: ui?.getBoundingClientRect().right } })()`)
  assert.equal(layout.uriText, new URL('./ui.json', cam).href, `${label}: UI URI is missing`)
  assert(layout.page <= layout.viewport, `${label}: document overflows at ${width}px`)
  assert(layout.meta <= layout.metaClient && layout.uri <= layout.uriClient && layout.uriRight <= layout.uiRight, `${label}: UI URI is clipped at ${width}px`)
}
function colorContrast(foreground, background) {
  function rgb(color) {
    assert(/^rgba?\(/.test(color), `cannot measure computed color: ${color}`)
    const channels = color.match(/[\d.]+/g).map(Number)
    assert(channels.length === 3 || channels[3] === 1, `contrast requires an opaque surface: ${color}`)
    return channels.slice(0, 3)
  }
  function luminance(color) {
    const channels = rgb(color).map(value => value / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4)
    return channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722
  }
  const first = luminance(foreground), second = luminance(background)
  return (Math.max(first, second) + .05) / (Math.min(first, second) + .05)
}
async function assertWorkingSurface(label) {
  const visual = await evaluate(`(() => {
    const region = document.querySelector('fieldset[aria-label="Current view"]');
    const style = getComputedStyle(region);
    function surroundingColor(input) {
      for (let parent = input.parentElement; parent; parent = parent.parentElement) {
        const color = getComputedStyle(parent).backgroundColor;
        if (color !== 'rgba(0, 0, 0, 0)' && color !== 'transparent') return color;
      }
      throw Error('Cannot measure input boundary without an opaque surrounding surface');
    }
    return {padding: [style.paddingTop, style.paddingRight, style.paddingBottom, style.paddingLeft].map(parseFloat),
      inputs: [...region.querySelectorAll('input:not(:disabled)')].map(input => {
        const css = getComputedStyle(input);
        return {name: input.name, edges: ['Top','Right','Bottom','Left'].map(edge => ({edge,style:css['border'+edge+'Style'],color:css['border'+edge+'Color'],width:parseFloat(css['border'+edge+'Width'])})), fill: css.backgroundColor, surround: surroundingColor(input)};
      })};
  })()`)
  assert(visual.padding.every(value => value >= 12), `${label}: working content has insufficient inset from the view boundary`)
  for (const input of visual.inputs) {
    for (const edge of input.edges) {
      assert(edge.width > 0 && edge.style !== 'none' && edge.style !== 'hidden', `${label}: ${input.name} has no visible ${edge.edge} input boundary`)
      assert(colorContrast(edge.color, input.fill) >= 3 && colorContrast(edge.color, input.surround) >= 3, `${label}: ${input.name} ${edge.edge} input boundary contrast is below 3:1`)
    }
  }
}
async function assertVisibleInputFocus() {
  // Forced CSS state checks the authored indicator; native keyboard traversal
  // remains a separate interaction check.
  await call('DOM.enable', {}, sessionId)
  await call('CSS.enable', {}, sessionId)
  const root = (await call('DOM.getDocument', {}, sessionId)).root.nodeId
  const nodeId = (await call('DOM.querySelector', {nodeId: root, selector: 'input:not(:disabled)'}, sessionId)).nodeId
  assert(nodeId, 'view has no editable input for focus styling')
  const normal = await evaluate(`(() => { const input = document.querySelector('input:not(:disabled)'); input.blur(); const css = getComputedStyle(input); return {style:css.outlineStyle,width:parseFloat(css.outlineWidth),color:css.outlineColor}; })()`)
  await call('CSS.forcePseudoState', {nodeId, forcedPseudoClasses: ['focus-visible']}, sessionId)
  try {
    const focus = await evaluate(`(() => {
      const input=document.querySelector('input:not(:disabled)'),css=getComputedStyle(input),rect=input.getBoundingClientRect();
      const expansion=parseFloat(css.outlineWidth)+parseFloat(css.outlineOffset);
      let clip;
      for(let parent=input.parentElement;parent;parent=parent.parentElement){
        const style=getComputedStyle(parent),x=style.overflowX!=='visible',y=style.overflowY!=='visible';
        if(x||y){const r=parent.getBoundingClientRect();clip={x,y,left:r.left+parent.clientLeft,top:r.top+parent.clientTop,right:r.left+parent.clientLeft+parent.clientWidth,bottom:r.top+parent.clientTop+parent.clientHeight};break;}
      }
      return {style:css.outlineStyle,width:parseFloat(css.outlineWidth),color:css.outlineColor,surface:getComputedStyle(document.querySelector('.ui')).backgroundColor,ring:{left:rect.left-expansion,top:rect.top-expansion,right:rect.right+expansion,bottom:rect.bottom+expansion},clip};
    })()`)
    assert(focus.style !== 'none' && focus.width > 0, 'editable input has no visible focus outline')
    assert(colorContrast(focus.color, focus.surface) >= 3, 'focus outline contrast is below 3:1')
    assert(normal.style !== focus.style || normal.width !== focus.width || normal.color !== focus.color, 'focus indicator does not distinguish focus from the ordinary input')
    if (focus.clip) {
      assert(!focus.clip.x || (focus.ring.left >= focus.clip.left && focus.ring.right <= focus.clip.right), 'focus outline is clipped horizontally')
      assert(!focus.clip.y || (focus.ring.top >= focus.clip.top && focus.ring.bottom <= focus.clip.bottom), 'focus outline is clipped vertically')
    }
  } finally {
    await call('CSS.forcePseudoState', {nodeId, forcedPseudoClasses: []}, sessionId)
  }
}
const regressions = []
async function browserCase(name, run) {
  try { await run(); console.log(`${name}: passed`) }
  catch (error) { regressions.push(`${name}: ${error.message}`); console.error(`${name}: ${error.message}`) }
}
async function freshForm() {
  await call('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false }, sessionId)
  await openViewer(viewer.href)
  await waitFor(async state => state.heading === 'Create and fund an escrow agreement' && (await field('agreementRef')) !== undefined, 'fresh create form', true)
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
  const ready = await waitFor(state => state.heading === 'Create and fund an escrow agreement', 'Escrow root view', true)
  assert(ready.text.includes('Agreement reference'), 'Escrow form did not render')
  assert(ready.text.indexOf('Agreement reference') < ready.text.indexOf('Paste an agreement ID copied from an agreement view:'), 'creation task precedes ID navigation')
  const resources = [cam.href, new URL('./ui.json', cam).href, new URL('./abi/CamEscrow.json', cam).href, new URL('./abi/CamEscrowUI.json', cam).href]
  await waitFor(() => resources.every(resource => loaded.has(resource)), 'CAM resource completion events')
  for (const resource of resources) assert(loaded.has(resource), `required CAM resource did not finish: ${resource}`)
  assert(rootRequestId, 'root CAM request was not observed')
  const rootResponse = await call('Network.getResponseBody', { requestId: rootRequestId }, sessionId)
  const rootText = Buffer.from(rootResponse.body, rootResponse.base64Encoded ? 'base64' : 'utf8').toString('utf8')
  JSON.parse(rootText)
  alteredCamBody = `${rootText}\n`
  assert.deepEqual(failures.filter(failure => failure.reason !== 'net::ERR_ABORTED' || !loaded.has(failure.url)), [], 'unexpected network failures')
  assert.deepEqual(exceptions, [], 'browser exceptions')
  assert.deepEqual(consoleErrors, [], 'browser console errors')
  await browserCase('working surface padding, input contrast and reflow at supported widths', async () => {
    for (const width of [1280, 320, 375]) {
      await assertNarrowUi('Escrow root', width)
      await assertWorkingSurface(`Escrow root at ${width}px`)
    }
    await assertVisibleInputFocus()
  })
  await browserCase('contract limits show exact units and readable choices compactly', async () => {
    for (const width of [1280, 320, 375]) {
      await assertNarrowUi('Contract limits', width)
      const limits = await evaluate(`(() => {
        const names=['Reference limit','Document URI limit','Maximum phase duration','Allowed arbitration timeout recipients'];
        const rows=names.map(name=>[...document.querySelectorAll('.key-value')].find(row=>row.querySelector('.key-label')?.textContent===name));
        if(rows.some(row=>!row)) return null;
        const first=rows[0].getBoundingClientRect(),last=rows.at(-1).getBoundingClientRect();
        return {values:rows.map(row=>row.lastElementChild.textContent),height:last.bottom-first.top,fontSize:parseFloat(getComputedStyle(rows[0]).fontSize)};
      })()`)
      assert(limits, 'creation limits are missing')
      assert.deepEqual(limits.values, ['128 bytes', '512 bytes', '365 days (31,536,000 seconds)', 'client, contractor'])
      assert(limits.height <= limits.fontSize * 16, `contract limits consume excessive vertical space at ${width}px`)
    }
  })
  await evaluate(`document.querySelectorAll('button') && [...document.querySelectorAll('button')].find(button => button.textContent.includes('View account credit'))?.click()`)
  const creditView = await waitFor(state => state.text.includes('Total withdrawable credit for this account (wei)'), 'account credit view', false)
  assert.equal(creditView.heading, 'Withdraw account credit')
  assert(creditView.text.indexOf('Withdrawal recipient') < creditView.text.indexOf('Paste an agreement ID copied from an agreement view:'), 'withdrawal task precedes ID navigation')
  await browserCase('empty-credit controls share input boundaries and narrow reflow', async () => {
    for (const width of [1280, 320, 375]) {
      await assertNarrowUi('account credit', width)
      await assertWorkingSurface(`account credit at ${width}px`)
    }
    assert.equal(await evaluate("document.querySelector('input[name=recipient]')?.matches(':disabled')"), true, 'empty credit recipient must remain visible and disabled')
    assert.equal(await evaluate("[...document.querySelectorAll('button')].find(button=>button.textContent.trim()==='Prepare withdrawal transaction')?.disabled"), true, 'empty credit withdrawal must remain visible and disabled')
  })

  await browserCase('known agreement ID without create inputs', async () => {
    await freshForm()
    const knownId = `0x${'ab'.repeat(32)}`
    await enter('agreementId', knownId)
    await clickButton('Open agreement by ID')
    await waitFor(state => state.text.includes('No agreement is stored for this ID in this escrow contract.'), 'known ID lookup')
    assert((await evaluate('document.body.innerText')).includes(knownId), 'lookup did not show the requested agreement ID')
    for (const width of [1280, 320, 375]) {
      await assertNarrowUi('agreement lookup', width)
      await assertWorkingSurface(`agreement lookup at ${width}px`)
      assert.equal(await field('agreementId'), knownId, 'narrow layout changed the selected agreement ID')
    }
  })

  await browserCase('initial read fragment, refresh, and exact lookup default', async () => {
    const id = `0x${'ac'.repeat(32)}`
    const linked = new URL(viewer)
    linked.hash = new URLSearchParams({ route: 'agreement', inputs: JSON.stringify({ agreementId: id }) }).toString()
    await openViewer(linked.href)
    await waitFor(state => state.text.includes('No agreement is stored for this ID in this escrow contract.'), 'initial linked agreement', true)
    assert.equal(await field('agreementId'), id, 'selected ID was not supplied to the lookup draft')
    assert.equal(await field('agreementRef'), undefined, 'initial read link rendered a creation draft')
    assert.equal(await evaluate("[...document.querySelectorAll('button')].find(button => button.textContent.trim() === 'Back')?.disabled"), true, 'initial direct link created phantom history')
    const committed = await evaluate('location.href')
    const loader = (await call('Page.getFrameTree', {}, sessionId)).frameTree.frame.loaderId
    await call('Page.reload', {}, sessionId)
    await waitFor(async () => (await call('Page.getFrameTree', {}, sessionId)).frameTree.frame.loaderId !== loader, 'linked refresh document')
    await waitFor(state => state.text.includes('No agreement is stored for this ID in this escrow contract.'), 'linked agreement refresh', true)
    assert.equal(await field('agreementId'), id)
    assert.equal(await evaluate('location.href'), committed)
    assert.equal(transactionRequests.length, 0, 'opening a read link requested a transaction')
  })

  await browserCase('URL follows successful reads, not edited or rejected lookup drafts', async () => {
    await freshForm()
    const first = `0x${'ad'.repeat(32)}`
    await enter('agreementId', first)
    await clickButton('Open agreement by ID')
    await waitFor(state => state.text.includes('No agreement is stored for this ID in this escrow contract.'), 'lookup URL synchronization')
    const committed = new URL(await evaluate('location.href'))
    const fragment = new URLSearchParams(committed.hash.slice(1))
    assert.equal(fragment.get('route'), 'agreement')
    assert.equal(fragment.get('agreementId'), first)
    assert.equal(fragment.has('inputs'), false, 'string inputs retained a JSON envelope')
    const second = `0x${'ae'.repeat(32)}`
    await enter('agreementId', second)
    assert.equal(await evaluate('location.href'), committed.href, 'editing changed the selected agreement URL')
    await enter('agreementId', 'not-an-identifier')
    await clickButton('Open agreement by ID')
    await waitFor(async () => (await feedback('notice'))?.role === 'alert' && !await evaluate('document.querySelector(".elements")?.disabled'), 'rejected lookup')
    assert.equal(await evaluate('location.href'), committed.href, 'failed lookup changed the committed URL')
    assert.equal(await field('agreementId'), 'not-an-identifier', 'failed lookup discarded correction input')
    assert((await evaluate('document.body.innerText')).includes(first), 'failed lookup changed the loaded agreement')
  })

  await browserCase('fragment navigation and clearing use ordinary reads and viewer Back', async () => {
    await freshForm()
    await enter('agreementRef', 'hash-back-draft')
    await evaluate(`location.hash = new URLSearchParams({ route: 'accountCredit', inputs: '{}' }).toString()`)
    await waitFor(state => state.text.includes('Total withdrawable credit for this account (wei)'), 'live fragment credit navigation')
    await clickButton('Back')
    await waitFor(async () => (await field('agreementRef')) === 'hash-back-draft', 'fragment navigation Back draft')
    const returned = new URLSearchParams(new URL(await evaluate('location.href')).hash.slice(1))
    assert.equal(returned.get('route'), 'createAgreementForm')
    await evaluate(`location.hash = new URLSearchParams({ route: 'accountCredit', inputs: '{}' }).toString()`)
    await waitFor(state => state.text.includes('Total withdrawable credit for this account (wei)'), 'credit before clearing fragment')
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
      assert(await evaluate(`(()=>{const fields=[...document.querySelectorAll('.amount-field input')];return fields.length===2&&fields.every(field=>field.matches(':disabled')&&field.getBoundingClientRect().width>0);})()`), 'pending read must keep both amount controls visible and disabled')
      assert(await evaluate(`['acceptanceDuration','workDuration','reviewDuration','arbitrationDuration'].every(name=>{const field=document.querySelector('input[name="'+name+'"]');return field?.matches(':disabled')&&field.getBoundingClientRect().width>0;})`), 'pending read must keep integer controls visible and disabled')
      await evaluate(`location.hash = new URLSearchParams({ route: 'agreement', inputs: '{}' }).toString()`)
      await waitFor(async () => (await evaluate('location.href')) === committed && (await feedback('notice'))?.text.includes('Finish the current operation'), 'busy link rollback')
      assert.equal(await field('agreementRef'), 'pending-link-draft')
      for (const requestId of heldRequests.splice(0)) await call('Fetch.continueRequest', { requestId }, sessionId)
      await call('Fetch.disable', {}, sessionId)
      intercept = undefined
      await waitFor(state => state.text.includes('Total withdrawable credit for this account (wei)'), 'original credit read commits')
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
  async function amountInput(representation, text, caret) {
    const name = representation === 'base' ? 'amount' : 'amount.display'
    await evaluate(`(() => { const input=document.querySelector('input[name=${JSON.stringify(name)}]'); input.focus(); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(text)}); ${caret === undefined ? '' : `input.setSelectionRange(${caret},${caret});`} input.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:${JSON.stringify(text)},isComposing:false})); })()`)
  }
  await browserCase('paired amounts preserve exact active text, caret, accessible feedback and narrow reflow', async () => {
    await freshForm()
    for (const [display, base] of [['0.0100','10000000000000000'],['0.000000000000000001','1'],['9007199254740993.000000000000000001','9007199254740993000000000000000001']]) {
      await amountInput('display', display)
      await waitFor(async () => (await field('amount')) === base, 'exact paired amount')
      assert.equal(await field('amount.display'), display)
    }
    await amountInput('display','0.0100',3)
    await waitFor(async () => (await field('amount')) === '10000000000000000', 'caret-preserving paired render')
    const before = await evaluate(`(() => {const i=document.querySelector('input[name="amount.display"]');return {name:document.activeElement.name,start:i.selectionStart,end:i.selectionEnd};})()`)
    assert.deepEqual(before, {name:'amount.display',start:3,end:3})
    await amountInput('display','.')
    await waitFor(async () => (await field('amount')) === '', 'incomplete paired amount')
    await amountInput('display','0.0000000000000000001')
    await waitFor(async () => (await field('amount')) === '', 'overprecision paired amount')
    assert(await evaluate(`(()=>{const i=document.querySelector('input[name="amount.display"]');const hint=document.getElementById(i.getAttribute('aria-describedby'));return i.getAttribute('aria-invalid')==='true'&&hint?.getAttribute('role')==='status'&&/precision|decimal/i.test(hint.textContent)&&i.labels.length>0&&i.type==='text'&&i.inputMode==='decimal';})()`), 'invalid amount lacks associated accessible guidance')
    for (const width of [320,375]) {
      await call('Emulation.setDeviceMetricsOverride', {width,height:800,deviceScaleFactor:1,mobile:true}, sessionId)
      assert(await evaluate(`document.documentElement.scrollWidth<=innerWidth`), 'paired amount overflows narrow viewport')
    }
  })
  await browserCase('composition cancellation leaves no obsolete transport state after blur', async () => {
    await freshForm()
    await amountInput('display','0.0100')
    await evaluate(`document.querySelector('input[name="amount.display"]').dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}))`)
    await waitFor(async () => (await field('amount')) === '', 'composition start invalidation')
    await evaluate(`document.querySelector('input[name="amount.display"]').blur()`)
    await amountInput('display','0.0200')
    await waitFor(async () => (await field('amount')) === '20000000000000000', 'ordinary edit after cancelled composition')
  })
  await browserCase('Back restores unfinished composition without inventing a native composition phase', async () => {
    await freshForm()
    await enter('agreementRef','amount-composition-back')
    await amountInput('display','0.0300')
    await evaluate(`document.querySelector('input[name="amount.display"]').dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}))`)
    await waitFor(async () => (await field('amount')) === '', 'unfinished amount before navigation')
    await clickButton('Find agreement by client and reference')
    await waitFor(state => state.text.includes('No agreement is stored for this ID in this escrow contract.'), 'lookup during unfinished amount')
    await clickButton('Back')
    await waitFor(async () => (await field('amount.display')) === '0.0300', 'restored unfinished amount')
    assert.equal(await field('amount'), '', 'Back authorized an unfinished composition')
    await amountInput('display','0.0400')
    await waitFor(async () => (await field('amount')) === '40000000000000000', 'ordinary edit finishes restored amount')
  })
  await browserCase('raw multiline insertions cannot become a different valid amount through native sanitization', async () => {
    await freshForm()
    for (const kind of ['paste','beforeinput','noncancelable-beforeinput','composing-beforeinput']) {
      await amountInput('base','25')
      const composing = kind === 'composing-beforeinput'
      const cancelable = kind !== 'noncancelable-beforeinput' && !composing
      const prevented = await evaluate(`(()=>{const i=document.querySelector('input[name="amount"]');const raw='1\\n2';if(${composing})i.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));let event;if(${JSON.stringify(kind)}==='paste'){const transfer=new DataTransfer();transfer.setData('text/plain',raw);event=new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:transfer});}else event=new InputEvent('beforeinput',{bubbles:true,cancelable:${cancelable},inputType:'insertText',data:raw,isComposing:${composing}});i.dispatchEvent(event);if(!event.defaultPrevented){Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(i,raw);i.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:raw,isComposing:${composing}}));}if(${composing})i.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true,data:raw}));return event.defaultPrevented;})()`)
      if (cancelable) assert(prevented, `${kind} did not prevent the raw multiline insertion`)
      await waitFor(async () => (await field('amount')) === '' && (await field('amount.display')) === '', `${kind} bounded rejection`)
      assert(await evaluate(`(()=>{const i=document.querySelector('input[name="amount"]');const hint=document.getElementById(i.getAttribute('aria-describedby'));return i.getAttribute('aria-invalid')==='true'&&/one line|line breaks?/i.test(hint.textContent)&&/cleared/i.test(hint.textContent);})()`), `${kind} lacks associated rejection and recovery guidance`)
      await amountInput('base','26')
      await waitFor(async () => (await field('amount.display')) === '0.000000000000000026', `${kind} ordinary edit recovery`)
    }
  })
  await browserCase('account refresh resets composition transport with the authoritative fresh draft', async () => {
    const initialAccount = viewer.searchParams.get('account')
    const changedAccount = '0xa55aa83c7090d87b7aa151346862455d6209d789'
    assert.notEqual(initialAccount.toLowerCase(), changedAccount)
    const chainId = `0x${BigInt(viewer.searchParams.get('chainId').slice('eip155:'.length)).toString(16)}`
    const script = await call('Page.addScriptToEvaluateOnNewDocument', {source: `if(location.origin===${JSON.stringify(viewer.origin)}&&!window.ethereum){window.__amountFixtureAccount=${JSON.stringify(initialAccount)};window.ethereum={isAmountReadOnlyFixtureWallet:true,request:async({method,params})=>{if(method==='eth_chainId')return ${JSON.stringify(chainId)};if(method==='eth_accounts'||method==='eth_requestAccounts')return [window.__amountFixtureAccount];if(method==='wallet_switchEthereumChain'&&params?.[0]?.chainId===${JSON.stringify(chainId)})return null;throw Error('Read-only fixture provider cannot perform '+method)}};}`}, sessionId)
    try {
      await freshForm()
      assert(await evaluate(`window.ethereum?.isAmountReadOnlyFixtureWallet===true`), 'read-only fixture must not replace an existing wallet')
      await clickButton('Connect wallet')
      await waitFor(state => state.text.includes('Switch wallet'), 'read-only fixture connection')
      await amountInput('display','0.0100')
      await evaluate(`document.querySelector('input[name="amount.display"]').dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}))`)
      await evaluate(`void(window.__retiredAmountInput=document.querySelector('input[name="amount.display"]'))`)
      await waitFor(async () => (await field('amount')) === '', 'composition before account refresh')
      await evaluate(`window.__amountFixtureAccount=${JSON.stringify(changedAccount)}`)
      await clickButton('Switch wallet')
      await waitFor(async () => (await evaluate('location.search')).includes(changedAccount) && (await field('amount.display')) === '', 'fresh account draft')
      await evaluate(`(()=>{const input=window.__retiredAmountInput;Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'0.0100');input.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertCompositionText',data:'0.0100',isComposing:true}));input.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true,data:'0.0100'}));})()`)
      assert.equal(await field('amount'), '', 'retired composition restored an old canonical value after account refresh')
      assert.equal(await field('amount.display'), '', 'retired composition overwrote the fresh account draft')
      await amountInput('display','0.0200')
      await waitFor(async () => (await field('amount')) === '20000000000000000', 'ordinary edit after account refresh')
    } finally {
      await call('Page.removeScriptToEvaluateOnNewDocument', {identifier:script.identifier}, sessionId)
      await evaluate(`if(window.ethereum?.isAmountReadOnlyFixtureWallet)delete window.ethereum;delete window.__amountFixtureAccount;delete window.__retiredAmountInput`)
      await freshForm()
    }
  })
  async function fillDraft() {
    await freshForm()
    for (const [name, value] of Object.entries(draft)) await enter(name, value)
  }
  await browserCase('dedicated integer fields preserve lexical integers and give associated syntax and range feedback', async () => {
    await freshForm()
    for (const name of ['acceptanceDuration','workDuration','reviewDuration','arbitrationDuration']) {
      assert.equal(await field(name), '', `${name} must begin unset`)
      assert(await evaluate(`(()=>{const input=document.querySelector('input[name=${JSON.stringify(name)}]');return input.type==='text'&&input.inputMode==='numeric'&&input.labels.length>0&&input.getAttribute('aria-describedby')===null;})()`), `${name} lacks typed numeric input semantics`)
    }
    await enter('agreementRef','00042')
    assert.equal(await field('agreementRef'),'00042','numeric-looking identifiers were normalized')
    await enter('acceptanceDuration','0003600')
    assert(await evaluate(`document.querySelector('input[name="acceptanceDuration"]').getAttribute('aria-invalid')==='false'`), 'exact integer was marked invalid')
    await enter('acceptanceDuration','1.5')
    await waitFor(async () => await evaluate(`document.querySelector('input[name="acceptanceDuration"]').getAttribute('aria-invalid')==='true'`),'invalid integer before caret recovery')
    await evaluate(`(()=>{const input=document.querySelector('input[name="acceptanceDuration"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'0003601');input.setSelectionRange(3,3);input.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:'0003601'}));})()`)
    await waitFor(async () => await evaluate(`(()=>{const input=document.querySelector('input[name="acceptanceDuration"]');return input.getAttribute('aria-invalid')==='false'&&input.getAttribute('aria-describedby')===null;})()`),'integer renderer commits valid recovery')
    assert.equal(await field('acceptanceDuration'),'0003601','valid integer render rewrote lexical spelling')
    assert(await evaluate(`(()=>{const input=document.querySelector('input[name="acceptanceDuration"]');return document.activeElement===input&&input.selectionStart===3&&input.selectionEnd===3;})()`), 'integer render rewrote caret or focus')
    for (const [text, correction] of [['1.5',/whole|digits/],['-1',/whole|digits/],['1e3',/whole|digits/],['0',/1/],['31536001',/31536000/],['18446744073709551615',/31536000/]]) {
      await enter('acceptanceDuration',text)
      const feedback = await evaluate(`(()=>{const input=document.querySelector('input[name="acceptanceDuration"]');const hint=document.getElementById(input.getAttribute('aria-describedby'));return {invalid:input.getAttribute('aria-invalid'),hint:hint?.textContent,role:hint?.getAttribute('role')};})()`)
      assert.equal(feedback.invalid,'true',`${text} lacks invalid semantics`)
      assert.equal(feedback.role,'status',`${text} correction is not announced`)
      assert(correction.test(feedback.hint),`${text} lacks actionable correction`)
      assert.equal(await field('acceptanceDuration'),text,'invalid integer text was silently rewritten')
    }
    for (const width of [320,375]) {
      await call('Emulation.setDeviceMetricsOverride',{width,height:800,deviceScaleFactor:1,mobile:true},sessionId)
      assert(await evaluate(`document.documentElement.scrollWidth<=innerWidth`),'integer feedback overflows narrow viewport')
    }
  })
  await browserCase('integer composition cancellation and Back preserve unavailable drafts until an ordinary edit', async () => {
    await fillDraft()
    await evaluate(`document.querySelector('input[name="acceptanceDuration"]').dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}))`)
    await waitFor(async () => await evaluate(`document.getElementById(document.querySelector('input[name="acceptanceDuration"]').getAttribute('aria-describedby'))?.textContent.includes('Finish entering')`),'integer composition start')
    await clickButton('Find agreement by client and reference')
    await waitFor(state=>state.text.includes('No agreement is stored for this ID in this escrow contract.'),'lookup with unfinished integer')
    await clickButton('Back')
    await waitFor(async ()=>(await field('acceptanceDuration'))==='3600','restored unfinished integer')
    assert(await evaluate(`document.querySelector('input[name="acceptanceDuration"]').getAttribute('aria-describedby')!==null`),'Back authorized unfinished integer')
    await enter('acceptanceDuration','0003601')
    assert(await evaluate(`document.querySelector('input[name="acceptanceDuration"]').getAttribute('aria-describedby')===null`),'ordinary edit did not finish restored integer')
    await evaluate(`(()=>{const input=document.querySelector('input[name="acceptanceDuration"]');input.focus();input.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));input.blur();})()`)
    await enter('acceptanceDuration','0003602')
    assert(await evaluate(`document.querySelector('input[name="acceptanceDuration"]').getAttribute('aria-describedby')===null`),'blur left integer transport stuck composing')
  })
  await browserCase('component-shaped integer guidance wraps supported exact bounds without clipping', async () => {
    await freshForm()
    const before = await evaluate(`({width:innerWidth,height:innerHeight,scroll:scrollY,fields:[...document.querySelectorAll('.ui input')].map(input=>[input.name,input.value]),focus:document.activeElement.getAttribute('name')})`)
    await call('Emulation.setDeviceMetricsOverride',{width:320,height:800,deviceScaleFactor:1,mobile:true},sessionId)
    try {
      const geometry = await evaluate(`(()=>{const wrapper=document.createElement('div');wrapper.dataset.integerLayoutProbe='true';const label=document.createElement('label');label.className='field';const title=document.createElement('span');title.textContent='Supported exact integer bound';const input=document.createElement('input');input.type='text';input.inputMode='numeric';input.name='__integerBoundLayoutProbe';input.value='2'.repeat(1024);input.setAttribute('aria-invalid','true');input.setAttribute('aria-describedby','integer-bound-layout-probe-hint');label.append(title,input);const hint=document.createElement('p');hint.id='integer-bound-layout-probe-hint';hint.className='field-hint';hint.setAttribute('role','status');hint.textContent='Enter '+'1'.repeat(1024)+' or less.';wrapper.append(label,hint);document.querySelector('.elements').append(wrapper);const bounds=hint.getBoundingClientRect();const ui=document.querySelector('.ui').getBoundingClientRect();return {text:hint.textContent,left:bounds.left,right:bounds.right,uiLeft:ui.left,uiRight:ui.right,client:hint.clientWidth,scroll:hint.scrollWidth,page:document.documentElement.scrollWidth,viewport:innerWidth};})()`)
      assert.equal(geometry.text,'Enter '+'1'.repeat(1024)+' or less.','supported bound feedback was truncated')
      assert(geometry.page<=geometry.viewport,'supported bound feedback overflows the document')
      assert(geometry.left>=geometry.uiLeft&&geometry.right<=geometry.uiRight,'supported bound feedback is clipped by the working surface')
      assert(geometry.scroll<=geometry.client,'supported bound feedback is clipped inside its paragraph')
    } finally {
      await evaluate(`document.querySelector('[data-integer-layout-probe]')?.remove()`)
      await call('Emulation.setDeviceMetricsOverride',{width:before.width,height:before.height,deviceScaleFactor:1,mobile:false},sessionId)
      await waitFor(async ()=>await evaluate(`innerWidth===${before.width}&&innerHeight===${before.height}`),'restore geometry probe viewport')
      await evaluate(`scrollTo(0,${before.scroll})`)
      assert.deepEqual(await evaluate(`({width:innerWidth,height:innerHeight,scroll:scrollY,fields:[...document.querySelectorAll('.ui input')].map(input=>[input.name,input.value]),focus:document.activeElement.getAttribute('name')})`),before,'layout fixture changed the actual draft or focus')
    }
  })
  await browserCase('integer preparation uses canonical values while preserving active lexical spelling', async () => {
    await fillDraft()
    await enter('acceptanceDuration','0003600')
    await clickButton('Prepare creation transaction')
    await waitFor(async ()=>Boolean((await feedback('prepared'))?.text?.includes('Prepared contract call')),'integer prepared review')
    const review=await evaluate(`Object.fromEntries([...document.querySelectorAll('.prepared-call .key-value')].map(row=>[row.firstElementChild.textContent,row.lastElementChild.textContent]))`)
    assert.equal(JSON.parse(review.Args).params.acceptanceDuration,'3600')
    assert.equal(await field('acceptanceDuration'),'0003600')
    await enter('acceptanceDuration','1.5')
    assert(await evaluate(`document.querySelector('.prepared-call')===null`),'invalid integer retained an already prepared call')
    await clickButton('Prepare creation transaction')
    await waitFor(async ()=>Boolean((await feedback('notice'))?.text),'invalid integer preparation rejection')
    assert(await evaluate(`document.querySelector('.prepared-call')===null`),'invalid integer produced a new prepared call')
    assert.equal(transactionRequests.length,0,'integer preparation sent a transaction')
  })
  await browserCase('draft survives lookup, credit, and Back twice', async () => {
    await fillDraft()
    await clickButton('Find agreement by client and reference')
    await waitFor(state => state.text.includes('No agreement is stored for this ID in this escrow contract.'), 'reference lookup')
    await clickButton('View account credit')
    await waitFor(state => state.text.includes('Total withdrawable credit for this account (wei)'), 'credit from lookup')
    await clickButton('Back')
    await waitFor(state => state.text.includes('No agreement is stored for this ID in this escrow contract.'), 'Back to lookup')
    await clickButton('Back')
    await waitFor(async () => (await field('agreementRef')) !== undefined, 'Back to draft')
    for (const [name, value] of Object.entries(draft)) assert.equal(await field(name), value, `${name} draft was lost`)
  })

  // Start at the bottom of the long form; feedback must arrive where the user is.
  await browserCase('prepare rejection feedback', async () => {
    await fillDraft()
    await enter('contractor', '0x0000000000000000000000000000000000000000')
    await clickButton('Prepare creation transaction')
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
    await clickButton('Prepare creation transaction')
    await waitFor(async () => /InvalidPartyConfiguration/.test((await feedback('notice'))?.text || ''), 'first rejection')
    await enter('amount', '43')
    assert.equal(await evaluate("document.activeElement?.getAttribute('name')"), 'amount', 'editing stole focus from amount')
    await clickButton('Prepare creation transaction')
    await waitFor(async () => (await feedback('notice'))?.focus === true, 'repeat rejection focus')
    assert.equal(await field('amount'), '43', 'repeat rejection discarded edit')
  })

  await browserCase('prepared review feedback', async () => {
    await fillDraft()
    await clickButton('Prepare creation transaction')
    await waitFor(async () => Boolean((await feedback('prepared'))?.text?.includes('Prepared contract call')), 'prepared review')
    const prepared = await feedback('prepared')
    assert(prepared.top >= 0 && prepared.top < prepared.height && prepared.bottom > 0, 'prepared review is outside the viewport')
    assert(prepared.focus, 'prepared review did not receive accessible focus')
    assert.equal(await field('agreementRef'), draft.agreementRef, 'prepare discarded draft')
    assert.equal(transactionRequests.length, 0, 'prepare sent a transaction before explicit wallet confirmation')
  })
  await browserCase('human edits prepare identical exact tuple amount and transaction value', async () => {
    for (const [display,base] of [['0.0100','10000000000000000'],['0.009007199254740993','9007199254740993'],['0.000000000000000001','1']]) {
      await fillDraft()
      await amountInput('display',display)
      await waitFor(async () => (await field('amount')) === base, 'canonical amount before preparation')
      await clickButton('Prepare creation transaction')
      await waitFor(async () => Boolean((await feedback('prepared'))?.text?.includes('Prepared contract call')), 'exact amount prepared review')
      const review = await evaluate(`Object.fromEntries([...document.querySelectorAll('.prepared-call .key-value')].map(row=>[row.firstElementChild.textContent,row.lastElementChild.textContent]))`)
      assert.equal(JSON.parse(review.Args).params.amount, base, 'prepared tuple amount changed precision')
      assert.equal(review['Value (wei)'], base, 'prepared transaction value differs from tuple amount')
      assert.equal(await field('amount.display'), display, 'preparation normalized active human input')
      assert.equal(transactionRequests.length, 0, 'preparation sent a transaction')
    }
  })

  await browserCase('an amount edit during delayed simulation cannot restore a stale prepared call', async () => {
    await fillDraft()
    intercept = 'hold'
    await call('Fetch.enable', {patterns:[{urlPattern:rpc.href,requestStage:'Request'}]}, sessionId)
    try {
      await clickButton('Prepare creation transaction')
      await waitFor(() => heldRequests.length > 0, 'paused preparation simulation')
      const simulationRequests = heldRequests.map(requestId => {
        const networkId = heldNetworkRequests.get(requestId)
        assert(typeof networkId === 'string' && requested.get(networkId) === rpc.href, 'paused simulation needs its exact RPC network identity')
        return networkId
      })
      await amountInput('display','.')
      assert.equal(await field('amount'), '', 'incomplete edit retained the amount being simulated')
      for (const requestId of heldRequests.splice(0)) await call('Fetch.continueRequest', {requestId}, sessionId)
      await call('Fetch.disable', {}, sessionId)
      intercept = undefined
      await waitFor(() => simulationRequests.every(networkId => completedNetworkRequests.has(networkId) && statuses.get(networkId) === 200), 'complete paused simulation response bodies')
      await evaluate(`new Promise(resolve=>{const channel=new MessageChannel();let turns=2;channel.port1.onmessage=()=>{if(--turns===0){channel.port1.close();channel.port2.close();resolve();}else channel.port2.postMessage(null);};channel.port2.postMessage(null);})`)
      assert(await evaluate(`document.querySelector('.prepared-call')===null`), 'completed simulation restored a prepared call for an obsolete amount')
      assert.equal(await field('amount.display'), '.', 'late simulation rewrote the current amount draft')
      assert.equal(transactionRequests.length, 0, 'delayed preparation sent a transaction')
    } finally {
      for (const requestId of heldRequests.splice(0)) await call('Fetch.continueRequest', {requestId}, sessionId)
      await call('Fetch.disable', {}, sessionId)
      intercept = undefined
    }
  })

  await browserCase('discard prepared review preserves draft', async () => {
    await fillDraft()
    await clickButton('Prepare creation transaction')
    await waitFor(async () => Boolean((await feedback('prepared'))?.text?.includes('Prepared contract call')), 'review before discard')
    await clickButton('Discard prepared call')
    await waitFor(async () => await evaluate("document.querySelector('.prepared-call') === null && document.activeElement === document.querySelector('.ui')"), 'discarded review and current-view focus')
    for (const [name, value] of Object.entries(draft)) assert.equal(await field(name), value, `${name} draft changed after discard`)
    assert.equal(transactionRequests.length, 0, 'discard sent a transaction')
  })

  await browserCase('explicit new agreement clears draft', async () => {
    await fillDraft()
    await clickButton('Find agreement by client and reference')
    await waitFor(state => state.text.includes('No agreement is stored for this ID in this escrow contract.'), 'lookup before new')
    await clickButton('Create an agreement')
    await waitFor(async () => (await field('agreementRef')) !== undefined, 'explicit new agreement')
    assert.equal(await field('agreementRef'), '', 'explicit new agreement retained the old reference')
    assert.equal(await field('amount'), '', 'explicit new agreement retained the old amount')
    assert.equal(await field('amount.display'), '', 'explicit new agreement retained the old display amount')
  })

  // The same valid CAM JSON with one extra byte must fail its onchain hash.
  assert.deepEqual(exceptions, [], 'unhandled exceptions during ordinary workflows')
  assert.deepEqual(consoleErrors, [], 'console errors during ordinary workflows')
  assert.deepEqual(transactionRequests, [], 'ordinary workflows sent a transaction')
  // Interception is restricted to this owned target's root CAM request.
  await call('Fetch.enable', { patterns: [{ urlPattern: cam.href, requestStage: 'Request' }] }, sessionId)
  intercept = 'tamper'
  await call('Page.navigate', { url: viewer.href }, sessionId)
  const tampered = await waitFor(state => state.text.includes('Cannot load viewer') && /CAM hash mismatch/i.test(state.text), 'CAM hash rejection', true)
  assert.notEqual(tampered.heading, 'Create and fund an escrow agreement', 'tampered CAM rendered as ready')
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
