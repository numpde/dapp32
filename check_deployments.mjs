import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const cdp = new URL(process.env.CDP_ORIGIN)
assert(cdp.protocol === 'http:' && !cdp.username && !cdp.password)
const site = process.env.SITE_ROOT
const page = 'https://numpde.github.io/dapp32/gallery/'
const legacy = 'https://numpde.github.io/dapp32/deployments/'
const catalogURL = 'https://raw.githubusercontent.com/numpde/dapp32/main/js/packages/cam-viewer/src/rpc-catalog.json'
const files = new Map()
for (const [url, path, type] of [
  [page, 'gallery/index.html', 'text/html'],
  [page + 'deployments.js', 'gallery/deployments.js', 'text/javascript'],
  [page + 'deployments.json', 'gallery/deployments.json', 'application/json'],
  ['https://numpde.github.io/dapp32/theme.js', 'theme.js', 'text/javascript'],
  ['https://numpde.github.io/dapp32/site.css', 'site.css', 'text/css'],
]) files.set(url, { body: await readFile(`${site}/${path}`), type })
// Check the executable redirect from the legacy route, including historical
// deep links, without aborting unrelated in-flight CDP RPC interceptions.
const redirectHTML = await readFile(`${site}/deployments/index.html`, 'utf8')
const redirectScript = redirectHTML.match(/<script>([\s\S]*?)<\/script>/)?.[1]
assert(redirectScript, 'Legacy deployment route must contain a redirect script')
function redirectedURL(search, hash) {
  let redirected
  const window = { location: { search, hash, replace(target) { redirected = new URL(target, legacy).href } } }
  new Function('window', redirectScript)(window)
  return redirected
}
assert.equal(redirectedURL('?source=bookmark', '#pay-to-play-fuji'), page + '?source=bookmark#pay-to-play-fuji')
assert.equal(redirectedURL('', '#pay-to-play-fuji-2026-11-08'), page + '#pay-to-play-fuji-2026-11-08')
assert.equal(redirectedURL('', ''), page)
const production = JSON.parse(files.get(page + 'deployments.json').body)
const host = production.deployments[0].host
const fixture = { viewer: production.viewer, previewViewer: production.previewViewer, deployments: [{ ...production.deployments[0], network: 'fixture', contracts: [
  { name: 'Registry', source: { address: '0x' + '1'.repeat(40), url: 'https://source.fixture.test/Registry.sol' } },
  { name: 'UI', source: { address: '0x' + '3'.repeat(40), url: 'https://source.fixture.test/UI.sol' } },
  { name: 'Unbound', source: { address: '0x' + '4'.repeat(40), url: 'https://source.fixture.test/Unbound.sol' } },
] }] }
fixture.deployments[0].hostVerificationUrl = `https://repo.sourcify.dev/31337/${host}`
for (const contract of fixture.deployments[0].contracts) {
  contract.source.verificationUrl = `https://repo.sourcify.dev/31337/${contract.source.address}`
}
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
    assert(fixture.deployments.some(deployment => deployment.host === message.params[0].to), 'Read must use one listed CAM root')
    assert.equal(message.params[1], '0x123', 'All bindings must use the captured block')
    const bytes = Buffer.from(message.params[0].data.slice(2), 'hex')
    assert.equal(bytes.subarray(0, 4).toString('hex'), '1eb726af')
    assert.equal(Number(bytes.readBigUInt64BE(28)), 32)
    const length = Number(bytes.readBigUInt64BE(60))
    const name = bytes.subarray(68, 68 + length).toString('utf8')
    assert(fixture.deployments[0].contracts.some(contract => contract.name === name))
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
const newTabActions = '[...document.querySelectorAll(".deployment .actions a")].every(a=>a.target==="_blank" && a.relList.contains("noopener") && a.relList.contains("noreferrer"))'
try {
  ;({ targetId } = await call('Target.createTarget', { url: 'about:blank', background: true }))
  ;({ sessionId } = await call('Target.attachToTarget', { targetId, flatten: true }, undefined))
  await call('Page.enable'); await call('Runtime.enable'); await call('Network.enable')
  await call('Emulation.setFocusEmulationEnabled', { enabled: true })
  await call('Network.setCacheDisabled', { cacheDisabled: true })
  await call('Fetch.enable', { patterns: [{ urlPattern: page + '*' }, { urlPattern: 'https://numpde.github.io/dapp32/site.css' }, { urlPattern: 'https://numpde.github.io/dapp32/theme.js' }, { urlPattern: catalogURL }, { urlPattern: publicRPC + '*' }, { urlPattern: customRPC + '*' }] })
  await navigate(); await until(working)
  const menu = await evaluate('(() => ({ links: [...document.querySelectorAll(".docs-section-links a")].map(a=>({text:a.textContent,hash:a.hash})), active: document.querySelectorAll(".docs-section-links a[aria-current=page]").length, frame: !!document.querySelector(".docs-layout > main.docs-main.deployment-page"), breadcrumb: !!document.querySelector(".docs-breadcrumb"), duplicate: !!document.querySelector("#deployment-jump") }))()')
  assert(menu.frame && menu.breadcrumb && menu.active === 1, 'The Gallery has one shared pre-rendered navigation frame')
  assert.deepEqual(menu.links.filter(link=>link.hash).map(link=>link.hash), ['#bike-nft-fuji', '#pay-to-play-fuji-2026-11-08'], 'Sidebar applications derive from the catalog')
  assert(!menu.duplicate, 'Do not append a second app navigation after data loads')
  assert.deepEqual(await evaluate('[...document.querySelectorAll(".deployment .actions a")].map(a=>a.textContent)'), ['Open app', 'Pages preview', 'App guide'], 'Both viewers and the app guide use plain labels')
  assert.equal(await evaluate('document.querySelectorAll(".deployment .actions .button").length'), 0, 'Navigation links do not use button styling')
  assert.equal(await evaluate('new URL(document.querySelector(".deployment .actions a:nth-child(2)").href).origin'), 'https://numpde.github.io', 'Pages preview uses Pages origin')
  assert(await evaluate(newTabActions), 'Both app actions open isolated new tabs')
  assert.equal(await evaluate('document.querySelectorAll(".deployment a[target=_blank]").length'), 3, 'Other deployment links keep their existing navigation behavior')
  assert.deepEqual(await evaluate('[...document.querySelectorAll(".address-controls code")].map(n=>n.textContent)'), [host, ...addresses])
  assert.equal(await evaluate('document.querySelectorAll(".deployment-heading select").length'), 0, 'A single deployment needs no selector')
  assert.equal(await evaluate('document.querySelectorAll(".contracts > div").length'), 4)
  const links = await evaluate(`[...document.querySelectorAll('.contracts > div')].map(row=>({name:row.querySelector('dt').textContent,source:row.querySelector('dt a')?.href,address:row.querySelector('dd a')?.href,verification:row.querySelector('.verification-link')?.href}))`)
  assert.equal(links[0].source, fixture.deployments[0].hostSource, 'CAM root links to its source')
  assert.equal(links[1].source, 'https://source.fixture.test/Registry.sol', 'a matching binding links to its source')
  assert.equal(links[2].source, undefined, 'a changed binding must not link to an unrelated source')
  assert.equal(links[3].source, undefined, 'an unbound name has no source claim')
  assert.deepEqual(links.map(row => row.verification), [
    fixture.deployments[0].hostVerificationUrl, fixture.deployments[0].contracts[0].source.verificationUrl, undefined, undefined,
  ], 'Verification links require matching recorded addresses; changed and unbound names have none')
  assert.equal(await evaluate('document.querySelector(".rpc-settings").open'), false, 'Healthy RPC settings are secondary')
  await evaluate('document.querySelector(".rpc-settings summary").focus()')
  // Native summary activation consumes Enter's character event as well as its key events.
  await call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' })
  await call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
  await until('document.querySelector(".rpc-settings").open')
  assert(await evaluate('document.querySelector(".rpc-controls select").getBoundingClientRect().height > 0'), 'Keyboard disclosure exposes the endpoint')
  await evaluate('document.querySelector(".rpc-settings summary").click()')
  for (const [index, address] of [host, ...addresses].entries()) assert.equal(links[index].address, `https://explorer.fixture.test/address/${address}`)
  assert.match(await evaluate('document.querySelector(".contracts").textContent'), /Not bound/)
  assert.equal(await evaluate('document.querySelector(".rpc-controls select").options.length'), 2, 'Key templates must not be selectable')
  assert.equal(await evaluate('document.querySelector(".rpc-controls select").selectedOptions[0].textContent'), 'rpc.fixture.test')
  for (const width of [1280, 900, 800, 600, 390, 320]) {
    await call('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: false })
    assert(await evaluate('document.documentElement.scrollWidth<=document.documentElement.clientWidth'), `Overflow at ${width}`)
    const layout = await evaluate(`(() => {
      const row = document.querySelector('.contracts > div')
      const label = row.querySelector('dt').getBoundingClientRect()
      const address = row.querySelector('.address-controls').getBoundingClientRect()
      const proof = row.querySelector('.verification-link').getBoundingClientRect()
      const font = parseFloat(getComputedStyle(row).fontSize)
      const aligned = (a, b) => Math.abs((a.top + a.bottom) - (b.top + b.bottom)) < font
      return {
        adjacent: address.left >= label.right && address.left - label.right < 4 * font,
        inline: aligned(address, proof),
        mobile: aligned(label, proof) && address.top >= label.bottom,
        contained: [...row.querySelectorAll('dt, dd, a, button')].every(node => node.getBoundingClientRect().right <= row.getBoundingClientRect().right + 1),
      }
    })()`)
    assert(layout.contained, `Contract actions escape their row at ${width}px`)
    if (width === 1280) assert(layout.adjacent && layout.inline, 'Desktop names, addresses and verification must read as one compact row')
    if (width === 320) assert(layout.mobile, 'Narrow rows pair the name with verification above the address and copy control')
  }
  await call('Emulation.setDeviceMetricsOverride', { width: 1280, height: 1000, deviceScaleFactor: 1, mobile: false })
  await evaluate('document.documentElement.style.fontSize="200%"')
  assert(await evaluate('document.documentElement.scrollWidth<=document.documentElement.clientWidth'), 'Enlarged text must reflow without horizontal scrolling')
  await evaluate('document.documentElement.style.removeProperty("font-size")')
  for (mode of ['fail', 'wrong-chain', 'malformed']) {
    observed = []; await navigate(); await until('document.querySelector(".deployment [role=alert]")')
    assert.equal(await evaluate('document.querySelectorAll(".contracts > div").length'), 1, 'No stale or partial binding rows')
    assert(await evaluate('document.querySelector(".rpc-settings").open'), 'Connection failures expose their recovery controls')
    assert(await evaluate('[...document.querySelectorAll(".deployment a")].some(a=>a.textContent==="Open app")'))
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
  assert(await evaluate('document.querySelector(".rpc-settings").open'), 'No endpoint: expose custom RPC entry immediately')
  assert.equal(observed.length, 0)
  await evaluate(`document.querySelector('.rpc-controls input').value=${JSON.stringify(customRPC)};document.querySelector('.rpc-controls input').dispatchEvent(new Event('input'))`); await until(working)
  // The same application has two independent immutable roots. A selector must preserve each one.
  const olderHost = '0x' + '7'.repeat(40)
  fixture.deployments = [
    { ...fixture.deployments[0], id: 'fixture-old', appId: 'fixture-app', deployedAt: '2026-10-30', host: olderHost, hostVerificationUrl: `https://repo.sourcify.dev/31337/${olderHost}` },
    { ...fixture.deployments[0], id: 'fixture-new', appId: 'fixture-app', deployedAt: '2026-11-08', host },
  ]
  catalog.fixture.services = { public: publicRPC }
  observed = []; await navigate(); await until(working)
  assert.equal(await evaluate('document.querySelectorAll(".deployment").length'), 1, 'One card per application')
  assert.deepEqual(await evaluate('[...document.querySelector("#deployment-select-fixture-app").options].map(option=>({id:option.value,text:option.textContent}))'), [
    { id: 'fixture-new', text: '2026-11-08 · Latest' },
    { id: 'fixture-old', text: '2026-10-30' },
  ])
  assert.equal(await evaluate('document.querySelector("#deployment-select-fixture-app").value'), 'fixture-new')
  assert.equal(await evaluate('document.querySelector(".deployment-instance").id'), 'fixture-new')
  assert.equal(await evaluate('document.querySelector(".deployment-heading select").getAttribute("aria-label")'), 'Bicycle component registry deployment')
  for (const width of [1280, 320]) {
    await call('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: false })
    const layout = await evaluate(`(() => {
      const heading = document.querySelector('.deployment-heading h2').getBoundingClientRect()
      const picker = document.querySelector('.deployment-heading select').getBoundingClientRect()
      return {
        inline: picker.left >= heading.right + 8 && Math.abs((picker.top + picker.bottom) - (heading.top + heading.bottom)) < 12,
        wrapped: picker.top >= heading.bottom,
        overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth
      }
    })()`)
    assert(!layout.overflow, `Deployment heading overflows at ${width}px`)
    assert(width === 1280 ? layout.inline : layout.wrapped, `Deployment selector layout at ${width}px: ${JSON.stringify(layout)}`)
  }
  await call('Emulation.clearDeviceMetricsOverride')
  assert.equal(await evaluate('new URL(document.querySelector(".deployment .actions a").href).searchParams.get("host")'), host)
  observed = []
  await evaluate('document.querySelector("#deployment-select-fixture-app").focus()')
  const selectionScroll = await evaluate('scrollY')
  await evaluate('document.querySelector("#deployment-select-fixture-app").value="fixture-old";document.querySelector("#deployment-select-fixture-app").dispatchEvent(new Event("change"))')
  await until('document.querySelector("#fixture-old .rpc-controls [role=status]")?.textContent === "✓"')
  assert.equal(await evaluate('location.hash'), '#fixture-old')
  assert.equal(await evaluate('new URL(document.querySelector(".deployment .actions a").href).searchParams.get("host")'), olderHost)
  assert.equal(await evaluate('new URL(document.querySelector(".deployment .actions a:nth-child(2)").href).searchParams.get("host")'), olderHost, 'Preview follows deployment selection')
  assert(await evaluate(newTabActions), 'Rebuilt actions retain isolated new tabs after switching deployments')
  assert(observed.some(request => request.method === 'eth_call' && request.params[0].to === olderHost), 'Selected root must receive RPC reads')
  assert(await evaluate('document.activeElement === document.querySelector("#deployment-select-fixture-app")'), 'Release switching retains keyboard focus')
  assert(Math.abs(await evaluate('scrollY') - selectionScroll) < 1, 'Selecting a release must not jump past its heading')
  await evaluate('history.back()')
  await until('document.querySelector("#deployment-select-fixture-app")?.value === "fixture-new" && !location.hash')
  await evaluate('history.forward()')
  await until('document.querySelector("#deployment-select-fixture-app")?.value === "fixture-old" && location.hash === "#fixture-old"')
  await call('Page.navigate', { url: page + '?history#fixture-old' })
  await until('document.querySelector("#deployment-select-fixture-app")?.value === "fixture-old"')
  await evaluate('document.querySelector("#deployment-select-fixture-app").value="fixture-new";document.querySelector("#deployment-select-fixture-app").dispatchEvent(new Event("change"))')
  await until('location.hash === "#fixture-new"')
  await evaluate('history.back()')
  await until('document.querySelector("#deployment-select-fixture-app")?.value === "fixture-old"')
  assert.equal(await evaluate('location.hash'), '#fixture-old', 'Back restores the older release URL and selection')
  console.log(JSON.stringify({ fixtures: true, pinnedReads: true, noWrites: true, wrongChainRejected: true, failureAndRetry: true, staleCompletionDiscarded: true, customWithoutCatalog: true, widths: [1280, 900, 800, 600, 390, 320], compactRows: true, responsiveVerification: true, enlargedText: true, rpcDisclosure: true, selectionKeepsFocusAndScroll: true, mockCopy: true, nativeClipboardTested: false, datedChoices: true, latestDefault: true, fragmentHistory: true, legacyDeepLinks: true }))
  if (process.env.LIVE_RPC === '1') {
    live = true; await navigate()
    const appCount = new Set(production.deployments.map(deployment => deployment.appId)).size
    await until(`[...document.querySelectorAll('.deployment')].length===${appCount}&&[...document.querySelectorAll('.deployment')].every(card=>card.querySelector('.rpc-controls [role=status]')?.textContent==='✓')`)
    for (const deployment of production.deployments) {
      if (production.deployments.some(item => item.appId === deployment.appId && item.id !== deployment.id)) {
        await evaluate(`document.querySelector(${JSON.stringify('#deployment-select-'+deployment.appId)}).value=${JSON.stringify(deployment.id)};document.querySelector(${JSON.stringify('#deployment-select-'+deployment.appId)}).dispatchEvent(new Event('change'))`)
        await until(`document.querySelector(${JSON.stringify('#'+deployment.id+' .rpc-controls [role=status]')})?.textContent==='✓'`)
      }
      const rows = await evaluate(`[...document.querySelectorAll(${JSON.stringify('#'+deployment.id+' .contracts > div')})].map(row=>({name:row.querySelector('dt').textContent,source:row.querySelector('dt a')?.href,address:row.querySelector('dd code')?.title,explorer:row.querySelector('dd a')?.href}))`)
      assert.equal(rows[0].source, deployment.hostSource, `${deployment.id} root source`)
      assert.equal(rows[0].address.toLowerCase(), deployment.host.toLowerCase())
      for (const [index, contract] of deployment.contracts.entries()) {
        const row = rows[index + 1]
        assert.equal(row.name, contract.name)
        assert(row.address && row.explorer, `${deployment.id} ${contract.name} must be bound and link to its explorer`)
        assert.equal(row.source, row.address.toLowerCase() === contract.source.address.toLowerCase() ? contract.source.url : undefined, `${deployment.id} ${contract.name} source follows its recorded binding`)
      }
    }
    console.log(JSON.stringify({ liveReadOnlyRPC: true, deployments: production.deployments.length, sources: true, explorerLinks: true }))
  }
} finally {
  if (targetId) await call('Target.closeTarget', { targetId }, undefined)
  socket.close()
}
