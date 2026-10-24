import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { requireHttpURL } from '@cam/protocol'
import { awaitFixtureSocketOpen } from '../../../tools/browser-fixture-wallet.mjs'
import { createCdpCommands } from './escrow-browser-fixture.mjs'

const local = (value, label) => {
  const url = requireHttpURL(value, label)
  assert(url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(new URL(url.href).hostname), `${label} must be loopback HTTP`)
  return new URL(url.href)
}
const cdp = local(process.env.CDP_ORIGIN, 'CDP_ORIGIN')
const viewer = local(process.env.VIEWER_URL, 'VIEWER_URL')
const version = await (await fetch(new URL('/json/version', cdp), { signal: AbortSignal.timeout(5000) })).json()
const endpoint = new URL(version.webSocketDebuggerUrl)
assert.equal(endpoint.protocol, 'ws:')
assert.equal(endpoint.host, cdp.host)
const socket = new WebSocket(endpoint)
await awaitFixtureSocketOpen(socket, 5000)
const commands = createCdpCommands({ socket, now: Date.now, runDeadline: Date.now() + 120000 })
socket.addEventListener('message', event => commands.receive(JSON.parse(event.data)))
let target, session
const failures = []
const call = (method, params) => commands.call(method, params, session)
async function evaluate(expression) {
  const reply = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  assert(!reply.exceptionDetails, reply.exceptionDetails?.exception?.description)
  return reply.result.value
}
async function wait(expression) {
  const until = Date.now() + 15000
  while (Date.now() < until) {
    if (await evaluate(expression)) return
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  assert.fail(`IPFS fixture timed out: ${expression}; ${await evaluate('document.body.innerText.slice(0,1800)')}`)
}
async function select(id) {
  await evaluate(`(() => { const el=document.querySelector('.ipfs-gateway select');el.value=${JSON.stringify(id)};el.dispatchEvent(new Event('change',{bubbles:true})) })()`)
}
async function open(scenario) {
  const url = new URL('/test/ipfs-gateway-fixture.html', viewer)
  url.searchParams.set('scenario', scenario)
  await call('Page.navigate', { url: url.href })
  await wait('!!window.gatewayFixture')
}
try {
  target = (await commands.call('Target.createTarget', { url: 'about:blank', newWindow: false, background: true })).targetId
  session = (await commands.call('Target.attachToTarget', { targetId: target, flatten: true })).sessionId
  await call('Page.enable', {})
  await call('Runtime.enable', {})
  await call('Emulation.setFocusEmulationEnabled', { enabled: true })
  await call('Page.navigate', { url: new URL('/', viewer).href })
  await wait('!!document.querySelector(".error")')
  assert(await evaluate('!!document.querySelector(".ipfs-gateway select")'), 'the gateway remains visible when connection settings are missing')
  assert(await evaluate(`!!document.querySelector('#resource-origin-choice')`), 'resource access can be changed on the page, including after a failed startup')
  const policyExpression = `document.querySelector('#resource-origin-choice').selectedOptions[0]?.textContent`
  const policy = await evaluate(policyExpression)
  assert(policy === 'Any HTTP(S) origin' || policy.startsWith('Pinned to '), 'the HTTP resource policy is visible even when startup fails')
  await open('fail')
  await wait('!!document.querySelector(".error")')
  const options = await evaluate('[...document.querySelector(".ipfs-gateway select").options].map(o=>o.value)')
  assert(options.includes('pinata-public') && options.includes('filebase-public'))
  assert(!options.includes('ipfs-io') && !options.includes('dweb-link'), 'retired HTTP gateways are not offered')
  assert(!options.some(id => /dedicated|thirdweb|trustless/.test(id)), 'unconfigured credentials and CAR responses are not offered as file gateways')
  await select('pinata-public')
  await wait('!!document.querySelector("input[name=draft]")')
  assert.equal(await evaluate(policyExpression), policy, 'the same operator policy remains visible in the ready app')
  assert(await evaluate('!!document.querySelector(".connection .ipfs-gateway")&&!document.querySelector(".connection details")'), 'the gateway shares the always-visible connection facts')
  assert(await evaluate('document.querySelector(".ui-meta").textContent.includes("ipfs://")'), 'UI identity retains its logical IPFS URI')
  await evaluate(`(() => {const input=document.querySelector('input[name=draft]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'Keep this draft');input.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('.ipfs-gateway select').focus()})()`)
  const before = await evaluate('({href:location.href,requests:gatewayFixture.requests.length,account:document.querySelector(".connection").textContent})')
  const selectedBeforeKey = await evaluate('document.querySelector(".ipfs-gateway select").value')
  await call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowUp', code: 'ArrowUp', windowsVirtualKeyCode: 38 })
  await call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowUp', code: 'ArrowUp', windowsVirtualKeyCode: 38 })
  await call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r', unmodifiedText: '\r' })
  await call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
  assert(await evaluate('document.activeElement.tagName==="SELECT"'), 'keyboard gateway selection retains focus')
  assert.notEqual(await evaluate('document.querySelector(".ipfs-gateway select").value'), selectedBeforeKey, 'arrow key changes the selected gateway')
  await select('pinata-public')
  assert.deepEqual(await evaluate('({href:location.href,requests:gatewayFixture.requests.length,account:document.querySelector(".connection").textContent})'), before)
  assert.equal(await evaluate('document.querySelector("input[name=draft]").value'), 'Keep this draft')
  await evaluate(`[...document.querySelectorAll('.nft-row button')].find(b=>b.textContent==='Load preview').click()`)
  await wait('!!document.querySelector(".nft-image img")&&document.querySelector(".nft-image img").complete')
  assert(await evaluate('gatewayFixture.requests.some(uri=>uri.includes("gateway.pinata.cloud/ipfs/")&&uri.endsWith("/metadata/nft.json"))&&gatewayFixture.requests.some(uri=>uri.includes("gateway.pinata.cloud/ipfs/")&&uri.endsWith("/images/frame.png"))'), 'metadata and relative image use the selected gateway with the logical CID directory')
  const preview = await evaluate('({requests:gatewayFixture.requests.length,image:document.querySelector(".nft-image img").src})')
  await select('filebase-public')
  assert.deepEqual(await evaluate('({requests:gatewayFixture.requests.length,image:document.querySelector(".nft-image img").src})'), preview, 'selection does not reload an existing NFT preview')
  for (const width of [1280, 320]) {
    await call('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false })
    assert(await evaluate('document.documentElement.scrollWidth<=innerWidth'), `selector and NFT reflow at ${width}px`)
    if (process.env.PROOF_DIR) {
      const screenshot = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
      await writeFile(join(process.env.PROOF_DIR, `ipfs-gateway-${width}.png`), Buffer.from(screenshot.data, 'base64'))
    }
  }
  await call('Emulation.clearDeviceMetricsOverride', {})
  await open('fail')
  await wait('!!document.querySelector(".error")')
  await evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent==='Retry loading').click()`)
  await wait('!!document.querySelector("input[name=draft]")')
  await open('hold')
  await wait('gatewayFixture.requests.length===1')
  await select('pinata-public')
  await wait('!!document.querySelector("input[name=draft]")')
  assert.equal(await evaluate('gatewayFixture.aborted'), 1, 'abandoned initial gateway request is cancelled')
  assert(await evaluate('!document.querySelector(".error")'), 'an abandoned load cannot replace the newer ready view')
  await open('corrupt')
  await wait(`!!document.querySelector('input[name="draft"]')&&!!document.querySelector('[aria-label="UI integrity warnings"] [role="alert"]')`)
  assert(await evaluate(`document.querySelector('[aria-label="UI integrity warnings"]').textContent.includes(gatewayFixture.logicalRoot)`), 'mismatch diagnostics retain the logical IPFS source identity')
  await open('https')
  await wait('!!document.querySelector("input[name=draft]")')
  assert(await evaluate('!!document.querySelector(".connection .ipfs-gateway")'), 'the gateway remains available for an HTTPS-only app')
  const edit = async (selector, value) => evaluate(`(() => {const input=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(value)});input.dispatchEvent(new Event('input',{bubbles:true}))})()`)
  await edit('input[name=draft]', 'Keep this HTTPS draft')
  const httpsBefore = await evaluate('({href:location.href,requests:gatewayFixture.requests.length,draft:document.querySelector("input[name=draft]").value})')
  await select('pinata-public')
  assert.deepEqual(await evaluate('({href:location.href,requests:gatewayFixture.requests.length,draft:document.querySelector("input[name=draft]").value})'), httpsBefore, 'changing the gateway does not reload an HTTPS app or alter its draft')
  await edit('input[name=metadataURI]', 'ipfs://QmT78zSuBmuS4z925WZfrqQ1qHaJ56DQaTfyMUF7F8ff5o')
  await edit('input[name=metadataURI]', '')
  await edit('input[name=documentURI]', 'ipfs://QmT78zSuBmuS4z925WZfrqQ1qHaJ56DQaTfyMUF7F8ff5o')
  await edit('input[name=documentURI]', '')
  assert.equal(await evaluate('document.querySelector(".ipfs-gateway select")?.value'), 'pinata-public', 'clearing resource fields leaves the gateway visible and preserves its choice')
  const resourceBefore = await evaluate('({href:location.href,requests:gatewayFixture.requests.length,draft:document.querySelector("input[name=draft]").value})')
  const choosePolicy = async value => evaluate(`(() => {const choice=document.querySelector('#resource-origin-choice');choice.value=${JSON.stringify(value)};choice.dispatchEvent(new Event('change',{bubbles:true}))})()`)
  await choosePolicy('none')
  assert.equal(await evaluate(policyExpression), 'HTTP(S) disabled; IPFS only')
  assert.deepEqual(await evaluate('({href:location.href,requests:gatewayFixture.requests.length,draft:document.querySelector("input[name=draft]").value})'), resourceBefore, 'changing resource policy preserves a ready session and draft and fetches nothing')
  await choosePolicy(policy === 'Any HTTP(S) origin' ? '*' : 'https://raw.githubusercontent.com')
  await open('https-cross-origin')
  if (policy === 'Any HTTP(S) origin') {
    await wait('!!document.querySelector("input[name=draft]")')
    assert(await evaluate(`gatewayFixture.requests.includes('https://other.fixture.test/bundle/abi.json')&&gatewayFixture.requests.includes('https://other.fixture.test/bundle/ui.json')`), 'an unrestricted viewer also loads a bundle and its relative resources from a second HTTP origin')
  } else {
    await wait('!!document.querySelector(".error")')
    const refused = await evaluate(`({error:document.querySelector('.error').textContent,requests:gatewayFixture.requests})`)
    assert.match(refused.error, /outside allowed origin/, 'the failure names the pinned-origin restriction')
    assert(!refused.requests.some(uri=>uri.startsWith('https://other.fixture.test/')), `out-of-origin resources were fetched: ${JSON.stringify(refused.requests)}`)
    await choosePolicy('*')
    await wait('!!document.querySelector("input[name=draft]")')
    assert(await evaluate(`gatewayFixture.requests.includes('https://other.fixture.test/bundle/ui.json')`), 'explicitly allowing another origin immediately recovers a blocked startup')
  }
  assert.equal(await evaluate(policyExpression), 'Any HTTP(S) origin', 'the current explicit access choice remains visible after recovery')
  await open('https-hold')
  await wait('gatewayFixture.requests.length===1')
  await choosePolicy('none')
  await wait('!!document.querySelector(".error")')
  assert(await evaluate(`document.querySelector('.error').textContent.includes('disabled by the current resource policy')&&gatewayFixture.aborted===1`), 'changing a pending startup aborts its old download and retries under the new restriction')
  await choosePolicy('https://raw.githubusercontent.com')
  await wait('!!document.querySelector("input[name=draft]")')
  assert(await evaluate(`document.querySelector('#resource-origin-choice option[value="https://raw.githubusercontent.com"]')?.textContent==='Pinned to https://raw.githubusercontent.com'`), 'the pin offered on the page comes from the logical manifest origin')
  assert.equal(await evaluate(policyExpression), 'Pinned to https://raw.githubusercontent.com', 'selecting the discovered manifest pin recovers the failed startup under that restriction')
  console.log(JSON.stringify({ ipfsGateway: true, rootAndRelativeResources: true, retryAndCancellation: true, readyDraftPreserved: true, nftRelativeImage: true, narrowWidth: 320, resourcePolicy: policy }))
} catch (error) {
  failures.push(error)
} finally {
  try { if (target) await commands.call('Target.closeTarget', { targetId: target }, undefined, 'cleanup') } catch (error) { failures.push(error) }
  commands.close()
  socket.close()
}
if (failures.length === 1) throw failures[0]
if (failures.length > 1) throw new AggregateError(failures, 'IPFS browser check and owned cleanup failed')
