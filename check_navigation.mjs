import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

const root = process.env.SITE_ROOT
const cdp = new URL(process.env.CDP_ORIGIN)
assert(cdp.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(cdp.hostname))
const origin = 'https://navigation.fixture.test'
async function pages(directory) {
  const result = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory() && !/\/reference\/cam\/\d+\.\d+\.\d+$/.test(path)) result.push(...await pages(path))
    else if (entry.isFile() && entry.name.endsWith('.html') && !path.endsWith('/viewer/index.html') && !path.endsWith('/deployments/index.html')) result.push(path)
  }
  return result.sort()
}
const version = await (await fetch(new URL('/json/version', cdp), { signal: AbortSignal.timeout(5000) })).json()
assert.equal(new URL(version.webSocketDebuggerUrl).host, cdp.host)
const socket = new WebSocket(version.webSocketDebuggerUrl)
await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject })
let id = 0, session, target
const pending = new Map()
socket.onmessage = event => {
  const message = JSON.parse(event.data)
  if (message.id && pending.has(message.id)) {
    const { resolve, reject, timer } = pending.get(message.id)
    clearTimeout(timer); pending.delete(message.id)
    if (message.error) reject(new Error(`${message.error.message}`)); else resolve(message.result)
  } else if (message.method === 'Fetch.requestPaused') {
    void respond(message.params).catch(error => { failure = error })
  }
}
function call(method, params = {}, owner = session) {
  return new Promise((resolve, reject) => {
    const requestId = ++id
    const timer = setTimeout(() => { pending.delete(requestId); reject(new Error(`${method} timed out`)) }, 10000)
    pending.set(requestId, { resolve, reject, timer })
    socket.send(JSON.stringify({ id: requestId, method, params, ...(owner ? { sessionId: owner } : {}) }))
  })
}
let failure
async function respond(request) {
  const url = new URL(request.request.url)
  if (url.origin !== origin) return call('Fetch.failRequest', { requestId: request.requestId, errorReason: 'BlockedByClient' })
  const path = decodeURIComponent(url.pathname)
  if (path.includes('..')) throw new Error('Invalid fixture path')
  const relative = path.endsWith('/') ? `${path}index.html` : path
  let body, status = 200
  try { body = await readFile(join(root, relative)) } catch { body = Buffer.from('Not found'); status = 404 }
  const type = relative.endsWith('.css') ? 'text/css' : relative.endsWith('.html') ? 'text/html' : 'text/javascript'
  await call('Fetch.fulfillRequest', { requestId: request.requestId, responseCode: status, responseHeaders: [{ name: 'Content-Type', value: type }], body: body.toString('base64') })
}
async function evaluate(expression) {
  const result = await call('Runtime.evaluate', { expression, returnByValue: true })
  assert(!result.exceptionDetails, JSON.stringify(result.exceptionDetails))
  return result.result.value
}
async function visit(path) {
  await call('Page.navigate', { url: origin + path })
  for (let attempt = 0; attempt < 100; attempt++) {
    if (failure) throw failure
    const value = await evaluate(`(()=>{
      if(location.pathname!==${JSON.stringify(path)}||document.readyState!=='complete')return null;
      const nav=document.querySelector('nav[aria-label="Primary"]'),button=document.querySelector('#theme-toggle');
      if(!nav||!button)return null;
      const bar=nav.closest('.topbar'),a=nav.querySelector('a'),s=getComputedStyle(nav),t=getComputedStyle(a),b=getComputedStyle(bar),toggle=getComputedStyle(button);
      return {labels:[...nav.querySelectorAll('a')].map(x=>x.textContent),font:t.fontFamily,size:t.fontSize,color:t.color,display:t.display,minHeight:t.minHeight,gap:s.gap,background:b.backgroundColor,
        toggle:{font:toggle.fontFamily,width:toggle.width,height:toggle.height,color:toggle.color,background:toggle.backgroundColor},
        state:button.dataset.themeState,label:button.getAttribute('aria-label'),visible:button.checkVisibility(),count:document.querySelectorAll('#theme-toggle').length,
        body:getComputedStyle(document.body).backgroundColor,
        fit:[...nav.querySelectorAll('a'),button].every(x=>x.getBoundingClientRect().right<=innerWidth+1)};
    })()`)
    if (value) return value
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  throw new Error(`Shared site header did not load: ${path}`)
}
async function clickTheme(expected) {
  const value = await evaluate(`(()=>{const button=document.querySelector('#theme-toggle');button.click();return {state:button.dataset.themeState,label:button.getAttribute('aria-label'),choice:document.documentElement.dataset.theme,background:getComputedStyle(document.body).backgroundColor}})()`)
  assert.equal(value.state, expected)
  assert.equal(value.choice, expected)
  assert.equal(value.label, `Switch to ${expected === 'dark' ? 'light' : 'dark'} mode`)
  return value
}
async function followTask(href) {
  await visit('/')
  const focused = await evaluate(`(()=>{
    const link=[...document.querySelectorAll('main a')].find(a=>a.getAttribute('href')===${JSON.stringify(href)});
    if(!link)return false;link.focus();return document.activeElement===link;
  })()`)
  assert(focused, `Task link is missing or cannot receive keyboard focus: ${href}`)
  await call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 })
  await call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 })
  for (let attempt = 0; attempt < 100; attempt++) {
    if (failure) throw failure
    if (await evaluate(`location.pathname===${JSON.stringify('/' + href)}&&document.readyState==='complete'&&document.querySelector('h1')!==null&&document.querySelector('main#main')!==null`)) return
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  assert.fail(`Keyboard navigation did not reach the task: ${href}`)
}
try {
  target = (await call('Target.createTarget', { url: 'about:blank', background: true }, undefined)).targetId
  session = (await call('Target.attachToTarget', { targetId: target, flatten: true }, undefined)).sessionId
  await call('Page.enable'); await call('Runtime.enable'); await call('Emulation.setFocusEmulationEnabled', { enabled: true }); await call('Fetch.enable', { patterns: [{ urlPattern: '*' }] })
  await visit('/')
  assert.equal(await evaluate('document.querySelector("main h1")?.textContent'), 'Contract-defined workflows')
  assert.deepEqual(await evaluate('[...document.querySelectorAll("nav[aria-label=Primary] a")].map(a=>a.textContent)'), ['Start', 'Gallery', 'Use', 'Build', 'Deploy', 'Reference'])
  assert(await evaluate('[...document.querySelectorAll("main a")].filter(a=>a.getAttribute("href")==="gallery/").length >= 3'), 'Gallery is prominent within the original homepage layout')
  await visit('/gallery/')
  assert(await evaluate('document.querySelector("main h1")?.textContent === "Gallery" && !document.querySelector(".docs-rail")'), 'Gallery is an application collection, not a guide sidebar')
  // Navigation categories are not breadcrumb parents; only actual pages are.
  for (const [route, ancestors] of [
    ['/start/', []],
    ['/start/local-wallet.html', []],
    ['/start/fixture-wallet.html', ['Home', 'Try Pay-to-Play with a local wallet']],
    ['/pay-to-play/', []],
    ['/pay-to-play/integration.html', ['Home', 'Use Pay-to-Play']],
    ['/authoring/', []],
    ['/authoring/headless.html', []],
    ['/deployment/', []],
    ['/deployment/new-instance.html', ['Home', 'Deploy']],
    ['/deployment/pay-to-play/', ['Home', 'Deploy']],
    ['/reference/', []],
    ['/reference/operations.html', ['Home', 'Reference']],
    ['/gallery/', []],
  ]) {
    await visit(route)
    const links = await evaluate('[...document.querySelectorAll(".docs-breadcrumb a")].map(a => a.textContent.trim())')
    assert.deepEqual(links, ancestors, 'Only actual page parents appear for ' + route)
    assert(await evaluate('!document.querySelector(".docs-rail, .docs-layout, .docs-toc")'), 'No duplicate sidebar or generated contents menu: ' + route)
  }
  await visit('/use/')
  assert(await evaluate(`!!document.querySelector('main a[href="../gallery/"]')`), 'Use provides a direct route to Gallery')
  await visit('/pay-to-play/integration.html')
  assert(await evaluate('[...document.querySelectorAll("main article nav a")].some(a => a.getAttribute("href")?.startsWith("#"))'), 'Existing authored contents links remain')
  await call('Emulation.setDeviceMetricsOverride', { width: 390, height: 900, deviceScaleFactor: 1, mobile: false })
  await visit('/pay-to-play/integration.html')
  assert(await evaluate('document.documentElement.scrollWidth <= innerWidth'), 'Nested guide fits at mobile width')
  await call('Emulation.clearDeviceMetricsOverride')
  const files = await pages(root)
  for (const color of ['light', 'dark']) {
    await call('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: color }] })
    for (const width of [1280, 320]) {
      await call('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false })
      let reference
      for (const file of files) {
        await evaluate(`localStorage.removeItem('dapp32-theme')`)
        const path = file.slice(root.length).replace(/index\.html$/, '')
        const value = await visit(path)
        assert.equal(value.count, 1, `Expected one theme control: ${file}`)
        assert(value.visible && value.fit, `Shared header is missing a control or overflows at ${width}px: ${file}`)
        assert.equal(value.state, color, `Theme does not follow the system: ${file}`)
        assert.equal(value.label, `Switch to ${color === 'dark' ? 'light' : 'dark'} mode`)
        const { fit, ...style } = value
        if (reference === undefined) reference = style
        else assert.deepEqual(style, reference, `Header style differs: ${file} (${color}, ${width}px)`)
        const layout = await evaluate('(() => ({ aside: !!document.querySelector(".docs-rail, .docs-layout, .docs-toc"), overflow: document.documentElement.scrollWidth > innerWidth, main: !!document.querySelector("main#main") }))()')
        assert(layout.main && !layout.aside && !layout.overflow, 'Simple static page without duplicate navigation or horizontal overflow at ' + width + 'px: ' + file)
        const next = color === 'dark' ? 'light' : 'dark'
        const changed = await clickTheme(next)
        assert.notEqual(changed.background, value.body, `Theme choice did not change the rendered palette: ${file}`)
        assert.equal(await evaluate(`localStorage.getItem('dapp32-theme')`), next)
        assert.equal((await clickTheme(color)).background, value.body, `Second activation did not restore the palette: ${file}`)
      }
    }
  }
  // A choice must survive real document navigation rather than just a label change.
  await clickTheme('light')
  assert.equal((await visit('/authoring/')).state, 'light')
  await evaluate(`localStorage.setItem('dapp32-theme','invalid')`)
  assert.equal((await visit('/')).state, 'dark', 'Invalid saved choices use the system theme')
  await call('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] })
  await call('Page.captureScreenshot', { format: 'jpeg', quality: 10, captureBeyondViewport: false })
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await evaluate(`document.querySelector('#theme-toggle').dataset.themeState==='light'`)) break
    await new Promise(resolve => setTimeout(resolve, 20))
  }
  assert.equal(await evaluate(`document.querySelector('#theme-toggle').dataset.themeState`), 'light', 'An automatic theme follows later system changes')
  await clickTheme('dark')
  await call('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] })
  assert.equal(await evaluate(`document.querySelector('#theme-toggle').dataset.themeState`), 'dark')
  const blocked = await call('Page.addScriptToEvaluateOnNewDocument', { source: `Storage.prototype.getItem=()=>{throw new Error('Storage blocked')};Storage.prototype.setItem=()=>{throw new Error('Storage blocked')}` })
  assert.equal((await visit('/escrow/')).state, 'dark')
  const light = await clickTheme('light'), dark = await clickTheme('dark')
  assert.notEqual(light.background, dark.background, 'Denied storage must not break repeated theme changes')
  await call('Page.removeScriptToEvaluateOnNewDocument', { identifier: blocked.identifier })
  await call('Emulation.setScriptExecutionDisabled', { value: true })
  const staticHeader = await visit('/deployment/networks/')
  assert.equal(staticHeader.visible, false, 'A nonfunctional theme control stays hidden without JavaScript')
  assert(staticHeader.fit && staticHeader.labels.length === 6, 'Navigation remains usable without JavaScript')
  await visit('/gallery/')
  assert(await evaluate(`!!document.querySelector('main#main') && !document.querySelector('.docs-rail')`), 'Gallery remains usable without a redundant documentation menu')
  await visit('/use/')
  assert(await evaluate(`!document.querySelector('.docs-rail') && !!document.querySelector('main a[href="../gallery/"]')`), 'No-JS guides retain their own useful task links')
  await visit('/pay-to-play/integration.html')
  assert(await evaluate(`!!document.querySelector('.docs-breadcrumb a') && !document.querySelector('script[src*="docs-nav.js"]')`), 'No-JS nested guide has its actual parent link in initial HTML')
  assert.equal(await evaluate('document.querySelector("#theme-toggle").hidden'), true)
  await followTask('gallery/')
  await followTask('use/')
  await followTask('viewer/deploy.html')
  await followTask('start/local-wallet.html')
  await call('Emulation.setScriptExecutionDisabled', { value: false })
  console.log(JSON.stringify({ pages: files.length, widths: [1280, 320], themes: ['light', 'dark'], sharedToggle: true, savedChoice: true, systemChanges: true, storageDenied: true, staticNavigation: true, taskLayout: true, keyboardTaskLinks: true, externalRequests: 'blocked' }))
} finally {
  if (target) await call('Target.closeTarget', { targetId: target }, undefined)
  socket.close()
}
