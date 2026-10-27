import assert from 'node:assert/strict'
import { finishDisplayFixture, navigateBrowserDocument } from './escrow-browser-fixture.mjs'

export async function checkStartupErrors({ call, evaluate, viewerURL }) {
  const failures = []
  try {
    const missing = new URL(viewerURL)
    missing.searchParams.delete('chainId')
    const credentials = new URL(viewerURL)
    credentials.searchParams.set('rpcUrl', 'https://person:private-password@example.test/rpc?token=private-token')
    const longAddress = new URL(viewerURL)
    longAddress.searchParams.set('host', 'x'.repeat(3000))
    for (const [url, expected] of [[missing, /chainId/], [credentials, /credential|username|password/i], [longAddress, /address/i]]) {
      await navigateBrowserDocument({ call, url: url.href, description: 'the startup error view',
        ready: () => evaluate(`!!document.querySelector('.error .error-feedback')`) })
      assert(await evaluate(`!document.querySelector('.error .error-feedback details')&&!document.querySelector('.prepared-call')`), 'a failure is shown directly without disclosure or transaction controls')
      const primary = await evaluate(`document.querySelector('.error .feedback-message').innerText`)
      assert.match(primary, /could not be loaded/)
      assert.doesNotMatch(primary, /expected|Failed to construct|CAM_|private-/)
      const diagnostic = await evaluate(`document.querySelector('.error code').innerText`)
      assert.match(diagnostic, expected, 'the actual startup reason is visible immediately')
      assert(diagnostic.length < 2100, 'technical details are bounded')
      assert.doesNotMatch(await evaluate(`document.querySelector('.error').textContent`), /private-password|private-token/)
      for (const width of [1200, 320]) {
        await call('Emulation.setDeviceMetricsOverride', { width, height: 800, deviceScaleFactor: 1, mobile: false })
        await call('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: 1, height: 1, scale: 1 } })
        assert(await evaluate(`document.documentElement.scrollWidth<=innerWidth&&document.querySelector('.error code').scrollWidth<=document.querySelector('.error code').clientWidth`), `inline diagnostics fit ${width}px`)
      }
    }
    return { startupErrors: true, inlineDiagnostics: true, redaction: true, width: 320 }
  } catch (error) {
    failures.push(error)
  } finally {
    await finishDisplayFixture({ call, evaluate, viewerURL, failures })
  }
}
