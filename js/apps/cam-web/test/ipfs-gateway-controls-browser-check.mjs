import assert from 'node:assert/strict'
import { finishDisplayFixture, navigateBrowserDocument, waitForBrowserCondition } from './escrow-browser-fixture.mjs'

export async function checkIpfsGatewayControls({ call, evaluate, viewerURL }) {
  const wait = expression => waitForBrowserCondition(() => evaluate(expression), `gateway check: ${expression}`)
  const tick = `!!document.querySelector('[aria-label="Gateway test file retrieved"]')`
  const checking = `document.querySelector('.ipfs-gateway [aria-busy="true"]')`
  const choose = id => evaluate(`(() => {
    const select = document.querySelector('#ipfs-gateway-choice');
    select.focus(); select.value = ${JSON.stringify(id)};
    select.dispatchEvent(new Event('change', { bubbles: true }));
  })()`)
  const failures = []
  let result
  try {
    await navigateBrowserDocument({ call, url: new URL('/test/ipfs-gateway-fixture.html?scenario=https', viewerURL).href,
      description: 'gateway connectivity controls', ready: () => evaluate(`!!document.querySelector('#download-scope-choice')`) })
    await evaluate(`(() => {
      const select = document.querySelector('#download-scope-choice');
      select.value = 'https-or-ipfs'; select.dispatchEvent(new Event('change', { bubbles: true }));
    })()`)
    await wait(`!!document.querySelector('input[name=draft]')`)
    await evaluate(`(() => {
      const input = document.querySelector('input[name=draft]');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'Keep this draft');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    })()`)
    const app = await evaluate(`({ href: location.href, draft: document.querySelector('input[name=draft]').value })`)
    await wait(tick)
    assert(!await evaluate(`!!document.querySelector('button[aria-label="Check IPFS gateway"]')`), 'checking requires no button')
    const requests = await evaluate('gatewayFixture.probeRequests.length')
    await choose('pinata-public')
    await wait(tick)
    assert.equal(await evaluate('gatewayFixture.probeRequests.length'), requests + 1, 'selection automatically checks the new gateway')
    let selected = 'pinata-public'
    for (const mode of ['failure', 'wrong']) {
      await evaluate(`gatewayFixture.setProbeMode(${JSON.stringify(mode)})`)
      selected = selected === 'pinata-public' ? 'filebase-public' : 'pinata-public'
      await choose(selected)
      await wait(`!!document.querySelector('.ipfs-gateway [role=alert]')`)
      assert(!await evaluate(tick), 'failure removes the previous success')
      assert(await evaluate(`!!document.querySelector('.ipfs-gateway [aria-label="IPFS gateway check failed"]')`), 'failure has an explicit icon')
    }
    await evaluate(`gatewayFixture.setProbeMode('hold')`)
    await choose('filebase-public')
    await wait(`!!${checking}`)
    assert(await evaluate(`!!document.querySelector('.ipfs-gateway [aria-label="Checking IPFS gateway"] .icon')`), 'pending check shows a spinner')
    try {
      await call('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] })
      assert.equal(await evaluate(`getComputedStyle(document.querySelector('.ipfs-gateway [data-check-state="checking"] .icon')).animationName`), 'connection-check-spin')
      await call('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
      assert.equal(await evaluate(`getComputedStyle(document.querySelector('.ipfs-gateway [data-check-state="checking"] .icon')).animationName`), 'none')
    } finally {
      await call('Emulation.setEmulatedMedia', { features: [] })
    }
    assert(!await evaluate(tick))
    await evaluate(`gatewayFixture.setProbeMode('failure')`)
    await choose('pinata-public')
    await wait('gatewayFixture.probeAborted === 1')
    await wait(`!!document.querySelector('.ipfs-gateway [role=alert]')`)
    assert(await evaluate(`document.activeElement.id === 'ipfs-gateway-choice'`), 'selection preserves focus')
    await evaluate('gatewayFixture.releaseProbe()')
    await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
    assert(!await evaluate(tick), 'a late response cannot acknowledge a different gateway')
    assert(!await evaluate(`!!${checking}`))
    await evaluate(`gatewayFixture.setProbeMode('success')`)
    await choose('filebase-public')
    await wait(tick)
    assert.deepEqual(await evaluate(`({ href: location.href, draft: document.querySelector('input[name=draft]').value })`), app)
    assert.equal(await evaluate(`document.querySelector('#download-scope-choice').value`), 'https-or-ipfs')
    result = { gatewayCheck: 'automatic initial and selected retrieval, failures, cancellation, stale response, focus and app preservation' }
  } catch (error) { failures.push(error) } finally {
    await finishDisplayFixture({ call, evaluate, viewerURL, failures })
  }
  return result
}
