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
    else if (entry.isFile() && entry.name.endsWith('.html') && !path.endsWith('/viewer/index.html')) result.push(path)
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
    if (await evaluate(`location.pathname===${JSON.stringify('/' + href)}&&document.readyState==='complete'&&document.querySelector('main h1')!==null`)) return
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  assert.fail(`Keyboard navigation did not reach the task: ${href}`)
}
try {
  target = (await call('Target.createTarget', { url: 'about:blank', background: true }, undefined)).targetId
  session = (await call('Target.attachToTarget', { targetId: target, flatten: true }, undefined)).sessionId
  await call('Page.enable'); await call('Runtime.enable'); await call('Emulation.setFocusEmulationEnabled', { enabled: true }); await call('Fetch.enable', { patterns: [{ urlPattern: '*' }] })
  await visit('/')
  assert.equal(await evaluate('document.querySelector("#gallery h1")?.textContent'), 'Deployed apps')
  assert.deepEqual(await evaluate('[...document.querySelectorAll("[data-gallery-app] h2")].map(x=>x.textContent)'), ['Pay-to-Play', 'Bicycle component registry'])
  // Catalog hydration must make the latest real app reachable in one click,
  // without duplicating CAM host addresses in the homepage's static markup.
  let gallery
  for (let attempt = 0; attempt < 100; attempt++) {
    gallery = await evaluate(`(() => {
      const cards = [...document.querySelectorAll('[data-gallery-app]')]
      if (cards.some(card => card.querySelectorAll('.gallery-links a').length < 4)) return null
      return cards.map(card => ({
        name: card.querySelector('h2').textContent,
        links: [...card.querySelectorAll('.gallery-links a')].map(a => ({ label: a.textContent, href: a.href, target: a.target })),
        releases: [...card.querySelectorAll('select option')].map(o => ({ value: o.value, text: o.textContent })),
      }))
    })()`)
    if (gallery) break
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  assert(gallery, 'Homepage cards must gain direct viewer links from the deployment catalog')
  assert.deepEqual(gallery.map(card => card.links.map(a => a.label)), [
    ['Open app', 'Pages preview', 'Deployment details', 'Guide'],
    ['Open app', 'Pages preview', 'Deployment details', 'Guide'],
  ])
  assert.deepEqual(gallery[0].releases.map(o => o.text), ['2026-11-08 · Latest', '2026-10-30'])
  for (const card of gallery) {
    assert.equal(new URL(card.links[0].href).searchParams.get('chainId'), 'eip155:43113')
    assert.equal(new URL(card.links[1].href).searchParams.get('chainId'), 'eip155:43113')
    assert.equal(card.links[0].target, '_blank')
    assert.equal(card.links[1].target, '_blank')
  }
  assert.equal(new URL(gallery[0].links[0].href).searchParams.get('host').toLowerCase(), '0xaf64d347faac6aec8a80f2fc8420681619a9fa49')
  await evaluate(`(() => {
    const card = document.querySelector('[data-gallery-app="pay-to-play"]')
    card.querySelector('select').value = 'pay-to-play-fuji'
    card.querySelector('select').dispatchEvent(new Event('change'))
  })()`)
  assert.equal(await evaluate(`new URL(document.querySelector('[data-gallery-app="pay-to-play"] .gallery-links a').href).searchParams.get('host').toLowerCase()`), '0x2714d4566fff401957a9096c9a6c39d686877d3a')
  assert((await evaluate(`document.querySelector('[data-gallery-app="pay-to-play"] [data-gallery-details]').href`)).endsWith('/deployments/#pay-to-play-fuji'))
  assert.equal(await evaluate('document.querySelector("nav[aria-label=Primary] a:nth-child(2)").textContent'), 'Apps')
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
        const taskFits = await evaluate(`!document.querySelector('main.document > article.narrow')||document.documentElement.scrollWidth<=innerWidth+1`)
        assert(taskFits, `Task content widens the page at ${width}px: ${file}`)
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
  assert(staticHeader.fit && staticHeader.labels.length === 5, 'Navigation remains usable without JavaScript')
  assert.equal(await evaluate('document.querySelector("#theme-toggle").hidden'), true)
  await followTask('deployments/')
  await followTask('viewer/deploy.html')
  await followTask('start/local-wallet.html')
  await call('Emulation.setScriptExecutionDisabled', { value: false })
  console.log(JSON.stringify({ pages: files.length, widths: [1280, 320], themes: ['light', 'dark'], sharedToggle: true, savedChoice: true, systemChanges: true, storageDenied: true, staticNavigation: true, taskLayout: true, keyboardTaskLinks: true, externalRequests: 'blocked' }))
} finally {
  if (target) await call('Target.closeTarget', { targetId: target }, undefined)
  socket.close()
}
