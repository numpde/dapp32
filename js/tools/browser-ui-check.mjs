import assert from 'node:assert/strict'
import { requireHttpURL } from '@cam/protocol'
import { awaitFixtureSocketOpen } from './browser-fixture-wallet.mjs'
import { browserFixtureFailureDetails, BrowserFixtureError, createCdpCommands } from '../apps/cam-web/test/escrow-browser-fixture.mjs'
import { checkChoiceField } from '../apps/cam-web/test/choice-field-browser-check.mjs'
import { checkAddressEntry } from '../apps/cam-web/test/known-addresses-browser-check.mjs'
import { checkActionStyles } from '../apps/cam-web/test/action-style-browser-check.mjs'
import { checkNftMetadata } from '../apps/cam-web/test/nft-metadata-browser-check.mjs'
import { checkViewerConnection } from '../apps/cam-web/test/connection-browser-check.mjs'

function localURL(value, label) {
  const url = new URL(requireHttpURL(value, label).href)
  assert(url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname), `${label} must use loopback HTTP`)
  return url
}

async function main() {
  const viewer = localURL(process.env.VIEWER_URL, 'VIEWER_URL')
  const cdp = localURL(process.env.CDP_ORIGIN, 'CDP_ORIGIN')
  assert(cdp.pathname === '/' && !cdp.search && !cdp.hash, 'CDP_ORIGIN must be an origin')
  const fixture = await fetch(new URL('/test/action-style-fixture.html', viewer), { signal: AbortSignal.timeout(5000), redirect: 'error' })
  assert(fixture.ok, `Cannot run viewer UI checks: development fixtures returned HTTP ${fixture.status}. Start a local GUI demo and use its URL.`)
  await fixture.body?.cancel()
  const response = await fetch(new URL('/json/version', cdp), { signal: AbortSignal.timeout(5000), redirect: 'error' })
  assert(response.ok, 'Cannot connect to the CDP browser: version discovery failed')
  const endpoint = new URL((await response.json()).webSocketDebuggerUrl)
  assert(endpoint.protocol === 'ws:' && endpoint.host === cdp.host && !endpoint.username && !endpoint.password, 'CDP advertised an unexpected browser endpoint')
  const socket = new WebSocket(endpoint)
  await awaitFixtureSocketOpen(socket, 5000)
  const commands = createCdpCommands({ socket, now: Date.now, runDeadline: Date.now() + 240000 })
  socket.addEventListener('message', event => commands.receive(JSON.parse(event.data)))
  socket.addEventListener('close', () => commands.close())
  let target
  const failures = []
  try {
    target = (await commands.call('Target.createTarget', { url: 'about:blank', background: true })).targetId
    const session = (await commands.call('Target.attachToTarget', { targetId: target, flatten: true })).sessionId
    const call = (method, params) => commands.call(method, params, session)
    const evaluate = async expression => {
      const result = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
      if (result.exceptionDetails) throw new BrowserFixtureError('The viewer UI test script failed', { cause: result.exceptionDetails })
      return result.result.value
    }
    await call('Page.enable', {})
    await call('Runtime.enable', {})
    await call('Emulation.setFocusEmulationEnabled', { enabled: true })
    for (const check of [checkAddressEntry, checkChoiceField, checkActionStyles, checkNftMetadata, checkViewerConnection]) {
      console.log(`Running ${check.name}`)
      await call('Emulation.setFocusEmulationEnabled', { enabled: true })
      console.log(JSON.stringify(await check({ call, evaluate, viewerURL: viewer.href })))
    }
  } catch (error) { failures.push(error) }
  finally {
    try { if (target !== undefined) await commands.call('Target.closeTarget', { targetId: target }, undefined, 'cleanup') }
    catch (error) { failures.push(error) }
    commands.close()
    socket.close()
  }
  if (failures.length === 1) throw failures[0]
  if (failures.length > 1) throw new AggregateError(failures, 'Viewer UI checks and browser cleanup failed')
}

try { await main() }
catch (error) {
  console.error(browserFixtureFailureDetails(error) || 'Cannot run viewer UI checks. Check the local development viewer and CDP browser endpoints.')
  process.exitCode = 1
}
