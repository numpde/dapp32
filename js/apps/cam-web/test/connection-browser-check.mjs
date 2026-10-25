import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { finishDisplayFixture } from './escrow-browser-fixture.mjs'

export async function checkViewerConnection({ call, evaluate, viewerURL }) {
  async function wait(expression) {
    const deadline = Date.now() + 15000
    while (Date.now() < deadline) {
      if (await evaluate(expression)) return
      await new Promise(resolve => setTimeout(resolve, 50))
    }
    assert.fail(`Connection fixture did not reach: ${expression}; ${await evaluate('document.body.innerText.slice(0,1500)')}`)
  }
  async function open(scenario) {
    const url = new URL('/test/connection-fixture.html', viewerURL)
    url.searchParams.set('scenario', scenario)
    await call('Page.navigate', { url: url.href })
    await wait('!!window.connectionFixture')
  }
  const publicView = `document.querySelector('.connection-facts')?.textContent.includes('Public view')`
  const button = `document.querySelector('button[aria-label="Update record"]')`
  const failures = []
  try {
    await open('public')
    await wait('!!document.querySelector("input[name=draft]")')
    assert(await evaluate(publicView), 'public EVM reads are not presented as a selected account')
    assert(await evaluate(`connectionFixture.state.subjects.every(subject=>subject==='0x0000000000000000000000000000000000000000')&&!new URL(location.href).searchParams.has('account')`), 'the public read subject stays out of the shared account URL')
    assert(await evaluate(`${button}.disabled`), 'even a manifest-exposed transaction is unavailable in public mode')
    if (process.env.PROOF_DIR) {
      for (const width of [1280, 320]) {
        await call('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false })
        const screenshot = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
        await writeFile(join(process.env.PROOF_DIR, `public-view-${width}.png`), Buffer.from(screenshot.data, 'base64'))
      }
      await call('Emulation.clearDeviceMetricsOverride', {})
    }
    await evaluate(`${button}.click()`)
    assert(await evaluate('connectionFixture.state.reviews===0&&connectionFixture.state.simulations===0&&connectionFixture.state.sends===0'), 'public interaction never resolves, simulates or sends a write')
    await evaluate(`document.querySelector('button[aria-label="Next view"]').click()`)
    await wait(`document.querySelector('.topbar h1')?.textContent==='Connection detail'`)
    assert(await evaluate(`!new URL(location.href).searchParams.has('account')`), 'navigation preserves public link provenance')
    await evaluate('connectionFixture.state.failAccountRead=true;document.querySelector(".wallet-button").click()')
    await wait(`document.querySelector('.notice')?.textContent.includes('Cannot synchronize')`)
    assert(await evaluate(`${publicView}&&!new URL(location.href).searchParams.has('account')&&${button}.disabled`), 'failed wallet reconciliation preserves public mode and its link')
    await evaluate('connectionFixture.state.failAccountRead=false;document.querySelector(".wallet-button").click()')
    await wait(`new URL(location.href).searchParams.get('account')===connectionFixture.wallet&&!${button}.disabled`)
    assert(!(await evaluate(publicView)), 'successful account projection ends public mode')
    await evaluate('connectionFixture.emit("disconnect")')
    await wait(`document.querySelector('.wallet-value')?.textContent.includes('Not connected')`)
    assert(await evaluate(`new URL(location.href).searchParams.get('account')===connectionFixture.wallet&&!${publicView}`), 'disconnect keeps the last successfully selected viewing account')

    await open('explicit-zero')
    await wait('!!document.querySelector("input[name=draft]")')
    assert(await evaluate(`!${publicView}&&new URL(location.href).searchParams.get('account')==='0x0000000000000000000000000000000000000000'&&!${button}.disabled`), 'an explicit zero watch address remains a selected account')

    await open('account-required')
    await wait('!!document.querySelector(".panel.error")')
    assert(await evaluate(`!!document.querySelector('.wallet-button')`), 'a route rejecting public reads can still connect a wallet')
    await evaluate('document.querySelector(".wallet-button").click()')
    await wait(`!!document.querySelector('input[name=draft]')&&new URL(location.href).searchParams.get('account')===connectionFixture.wallet`)
    assert(await evaluate(`connectionFixture.listeners.get('accountsChanged')?.size===1`), 'bootstrap recovery keeps one wallet subscription')

    await open('held')
    await wait(`connectionFixture.state.subjects.length===1&&!!document.querySelector('.wallet-button')`)
    await evaluate('document.querySelector(".wallet-button").click()')
    await wait(`!!document.querySelector('input[name=draft]')&&new URL(location.href).searchParams.get('account')===connectionFixture.wallet`)
    await evaluate('connectionFixture.releasePublicReads();new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
    assert(await evaluate(`!${publicView}&&new URL(location.href).searchParams.get('account')===connectionFixture.wallet`), 'a completed old public load cannot replace the selected account view')
    await evaluate('connectionFixture.emit("chainChanged","0xa869")')
    await wait(`document.querySelector('.notice')?.textContent.includes('Wallet network differs')`)
    assert(await evaluate('connectionFixture.state.sends===0'), 'a changed wallet chain never sends during the public-view walkthrough')
    for (const width of [1280, 320]) {
      await call('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false })
      assert(await evaluate('document.documentElement.scrollWidth<=innerWidth'), `connection facts reflow at ${width}px`)
    }
    return { publicReadSubject: true, selectedZeroDistinct: true, walletRecovery: true, lateLoadDiscarded: true, sends: 0 }
  } catch (error) { failures.push(error) }
  finally { await finishDisplayFixture({ call, evaluate, viewerURL, failures }) }
}
