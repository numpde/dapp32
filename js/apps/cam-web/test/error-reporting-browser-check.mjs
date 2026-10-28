import assert from 'node:assert/strict'
import { finishDisplayFixture, navigateBrowserDocument, waitForBrowserCondition } from './escrow-browser-fixture.mjs'

export async function checkStartupErrors({ call, evaluate, viewerURL }) {
  async function assertInputFeedback(selector, expected) {
    await waitForBrowserCondition(() => evaluate(`!!document.querySelector(${JSON.stringify(selector)})`), 'input feedback')
    const feedback = `document.querySelector(${JSON.stringify(selector)})`
    assert(await evaluate(`!${feedback}.querySelector('details')`), 'input failures are visible without a disclosure')
    assert.doesNotMatch(await evaluate(`${feedback}.querySelector('.feedback-message').innerText`), /expected|Failed to construct|CAM_|private-/)
    const diagnostic = await evaluate(`${feedback}.querySelector('code').innerText`)
    assert.match(diagnostic, expected)
    assert(diagnostic.length < 2100, 'technical details are bounded')
    assert.doesNotMatch(await evaluate(`${feedback}.textContent`), /private-password|private-token/)
    assert(await evaluate(`!document.querySelector('.prepared-call')`))
    for (const width of [1200, 320]) {
      await call('Emulation.setDeviceMetricsOverride', { width, height: 800, deviceScaleFactor: 1, mobile: false })
      await call('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: 1, height: 1, scale: 1 } })
      assert(await evaluate(`document.documentElement.scrollWidth<=innerWidth&&${feedback}.querySelector('code').scrollWidth<=${feedback}.querySelector('code').clientWidth`), `inline diagnostics fit ${width}px`)
    }
  }
  const failures = []
  try {
    const missing = new URL(viewerURL)
    missing.searchParams.delete('chainId')
    const credentials = new URL(viewerURL)
    credentials.searchParams.set('rpcUrl', 'https://person:private-password@example.test/rpc?token=private-token')
    const longAddress = new URL(viewerURL)
    longAddress.searchParams.set('host', 'x'.repeat(3000))
    for (const url of [missing, longAddress]) {
      await navigateBrowserDocument({ call, url: url.href, description: 'the editable app setup',
        ready: () => evaluate(`!!document.querySelector('.app-setup')`) })
      assert.equal(await evaluate(`document.querySelector('#app-host').value`), url.searchParams.get('host'), 'invalid coordinates remain available for correction')
      assert(await evaluate(`!document.querySelector('.prepared-call')`), 'incomplete coordinates cannot prepare transactions')
      if (url === missing) {
        assert.equal(await evaluate(`document.querySelector('#app-chain').value`), '', 'a missing network is not silently replaced')
      } else {
        await waitForBrowserCondition(() => evaluate(`!!document.querySelector('#app-open')&&!document.querySelector('#app-open').disabled`), 'app setup submit control')
        await evaluate(`document.querySelector('#app-open').click()`)
        await assertInputFeedback('.app-setup [role="alert"]', /address/i)
      }
    }
    await navigateBrowserDocument({ call, url: credentials.href, description: 'the RPC input error',
      ready: () => evaluate(`!!document.querySelector('#rpc-connection-feedback')`) })
    await assertInputFeedback('#rpc-connection-feedback', /credential|username|password/i)
    return { startupErrors: true, inlineDiagnostics: true, redaction: true, width: 320 }
  } catch (error) {
    failures.push(error)
  } finally {
    await finishDisplayFixture({ call, evaluate, viewerURL, failures })
  }
}
