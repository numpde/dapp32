import assert from 'node:assert/strict'
import { finishDisplayFixture } from './escrow-browser-fixture.mjs'

export async function checkStartupErrors({ call, evaluate, viewerURL }) {
  async function wait(expression) {
    const deadline = Date.now() + 10000
    while (Date.now() < deadline) {
      if (await evaluate(expression)) return
      await new Promise(resolve => setTimeout(resolve, 50))
    }
    assert.fail(`Startup error did not reach: ${expression}`)
  }
  const failures = []
  let focusAttempted = false
  try {
    focusAttempted = true
    await call('Emulation.setFocusEmulationEnabled', { enabled: true })
    const missing = new URL(viewerURL)
    missing.searchParams.delete('chainId')
    const credentials = new URL(viewerURL)
    credentials.searchParams.set('rpcUrl', 'https://person:private-password@example.test/rpc?token=private-token')
    const longAddress = new URL(viewerURL)
    longAddress.searchParams.set('host', 'x'.repeat(3000))
    for (const [url, expected] of [[missing, /chainId/], [credentials, /credential|username|password/i], [longAddress, /address/i]]) {
      await call('Page.navigate', { url: url.href })
      await wait(`!!document.querySelector('.error .error-feedback details')`)
      const primary = await evaluate(`document.querySelector('.error [role="alert"]').innerText`)
      assert.match(primary, /could not be loaded/)
      assert.doesNotMatch(primary, /expected|Failed to construct|CAM_|private-/)
      assert(await evaluate(`!document.querySelector('.error details').open&&!document.querySelector('.prepared-call')`), 'diagnostics start closed and a failed app cannot offer a transaction')
      await evaluate(`document.querySelector('.error summary').focus()`)
      assert(await evaluate(`document.activeElement===document.querySelector('.error summary')`), 'the diagnostic disclosure accepts keyboard focus')
      await call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r', unmodifiedText: '\r' })
      await call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
      await wait(`document.querySelector('.error details').open`)
      const diagnostic = await evaluate(`document.querySelector('.error code').innerText`)
      assert.match(diagnostic, expected, 'opening details exposes the actual startup reason')
      assert(diagnostic.length < 2100, 'technical details are bounded')
      assert.doesNotMatch(await evaluate(`document.querySelector('.error').textContent`), /private-password|private-token/)
      for (const width of [1200, 320]) {
        await call('Emulation.setDeviceMetricsOverride', { width, height: 800, deviceScaleFactor: 1, mobile: false })
        await call('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: 1, height: 1, scale: 1 } })
        assert(await evaluate(`document.documentElement.scrollWidth<=innerWidth&&document.querySelector('.error code').scrollWidth<=document.querySelector('.error code').clientWidth`), `open diagnostics fit ${width}px`)
      }
    }
    return { startupErrors: true, keyboardDisclosure: true, redaction: true, width: 320 }
  } catch (error) {
    failures.push(error)
  } finally {
    if (focusAttempted) {
      try { await call('Emulation.setFocusEmulationEnabled', { enabled: false }) } catch (error) { failures.push(error) }
    }
    await finishDisplayFixture({ call, evaluate, viewerURL, failures })
  }
}
