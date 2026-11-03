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
    else if (entry.isFile() && entry.name.endsWith('.html')) result.push(path)
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
try {
  target = (await call('Target.createTarget', { url: 'about:blank', background: true }, undefined)).targetId
  session = (await call('Target.attachToTarget', { targetId: target, flatten: true }, undefined)).sessionId
  await call('Page.enable'); await call('Runtime.enable'); await call('Fetch.enable', { patterns: [{ urlPattern: '*' }] })
  const files = await pages(root)
  for (const color of ['light', 'dark']) {
    await call('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: color }] })
    for (const width of [1280, 320]) {
      await call('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false })
      let reference
      for (const file of files) {
        const path = file.slice(root.length).replace(/index\.html$/, '')
        await call('Page.navigate', { url: origin + path })
        let value
        for (let attempt = 0; attempt < 100; attempt++) {
          if (failure) throw failure
          const result = await call('Runtime.evaluate', { expression: `(()=>{if(location.pathname!==${JSON.stringify(path)}||document.readyState!=='complete')return null;const nav=document.querySelector('nav[aria-label="Primary"]');if(!nav)return null;const bar=nav.closest('.topbar'),a=nav.querySelector('a'),s=getComputedStyle(nav),t=getComputedStyle(a),b=getComputedStyle(bar);return {labels:[...nav.querySelectorAll('a')].map(x=>x.textContent),font:t.fontFamily,size:t.fontSize,color:t.color,display:t.display,minHeight:t.minHeight,gap:s.gap,background:b.backgroundColor,fit:[...nav.querySelectorAll('a')].every(x=>x.getBoundingClientRect().right<=innerWidth+1)}})()`, returnByValue: true })
          value = result.result.value
          if (value) break
          await new Promise(resolve => setTimeout(resolve, 50))
        }
        assert(value, `Primary navigation did not load: ${file}`)
        const { fit, ...style } = value
        assert(fit, `Primary navigation overflows at ${width}px: ${file}`)
        if (reference === undefined) reference = style
        else assert.deepEqual(style, reference, `Primary navigation style differs: ${file} (${color}, ${width}px)`)
      }
    }
  }
  console.log(JSON.stringify({ pages: files.length, widths: [1280, 320], themes: ['light', 'dark'], externalRequests: 'blocked' }))
} finally {
  if (target) await call('Target.closeTarget', { targetId: target }, undefined)
  socket.close()
}
