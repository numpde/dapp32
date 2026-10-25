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
    for (const scenario of ['bare', 'partial']) {
      await open(scenario)
      await wait(`!!document.querySelector('#app-host')`)
      assert.equal(await evaluate('connectionFixture.state.subjects.length'), 0, 'incomplete app coordinates cause no contract reads')
      if (scenario === 'partial') {
        assert.equal(await evaluate(`document.querySelector('#app-host').value`), 'needs correction', 'the setup form preserves the supplied invalid address')
        await evaluate(`document.querySelector('#rpc-apply').click()`)
        await wait(`!!document.querySelector('.app-setup [role="alert"]')`)
        assert(!(await evaluate(`document.querySelector('.app-setup [role="alert"]').textContent.includes('Cannot use this RPC')`)), 'invalid app coordinates are not reported as an RPC failure')
        assert.equal(await evaluate('connectionFixture.state.subjects.length'), 0, 'invalid app coordinates prevent contract reads')
      }
      await evaluate(`(() => { const choose=document.querySelector('#app-network');choose.value='custom';choose.dispatchEvent(new Event('change',{bubbles:true})) })()`)
      await wait(`!!document.querySelector('#app-chain')`)
      await evaluate(`(() => { for(const [selector,value] of [['#app-chain','eip155:31337'],['#app-host','0x0000000000000000000000000000000000000001']]) { const input=document.querySelector(selector);Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true})) } })()`)
      await wait(`!!document.querySelector('#rpc-endpoint-url')`)
      await evaluate(`(() => { const input=document.querySelector('#rpc-endpoint-url');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'https://rpc.fixture.test');input.dispatchEvent(new Event('input',{bubbles:true})) })()`)
      if (scenario === 'bare') {
        await evaluate(`(() => { const input=document.querySelector('#app-host');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'0x0000000000000000000000000000000000000004');input.dispatchEvent(new Event('input',{bubbles:true})) })()`)
        await evaluate(`document.querySelector('#rpc-apply').click()`)
        await wait(`!!document.querySelector('.panel.error')`)
        await evaluate(`[...document.querySelectorAll('button')].find(button=>button.textContent==='Edit app connection').click()`)
        await wait(`!!document.querySelector('#app-host')`)
        assert.equal(await evaluate(`document.querySelector('#app-host').value`), '0x0000000000000000000000000000000000000004', 'failed admission preserves the entered contract address for correction')
        assert.equal(await evaluate(`document.querySelector('#rpc-endpoint-url').value`), 'https://rpc.fixture.test/', 'reopened setup preserves the chosen custom RPC in memory')
        await evaluate(`(() => { const input=document.querySelector('#app-host');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'0x0000000000000000000000000000000000000001');input.dispatchEvent(new Event('input',{bubbles:true})) })()`)
      }
      await evaluate(`document.querySelector('#rpc-apply').click()`)
      await wait(`!!document.querySelector('input[name=draft]')`)
      assert.equal(await evaluate(`document.querySelector('#rpc-endpoint-url').value`), 'https://rpc.fixture.test/', 'the connection controls retain the chosen custom endpoint after setup')
      assert(await evaluate(`!new URL(location.href).searchParams.has('account')&&!new URL(location.href).searchParams.has('rpcUrl')`), 'opening an app requires neither a viewing account nor a credential-bearing share URL')
    }
    for (const scenario of ['choose-rpc', 'invalid-rpc']) {
      await open(scenario)
      await wait(`!!document.querySelector('#rpc-endpoint-choice')`)
      if (scenario === 'invalid-rpc') assert.equal(await evaluate(`document.querySelector('#rpc-endpoint-url').value`), 'not a URL', 'invalid explicit RPC remains available for correction')
      assert.equal(await evaluate('connectionFixture.state.subjects.length'), 0, 'no RPC read starts without a valid selected endpoint')
      await evaluate(`(() => { const input=document.querySelector('#rpc-endpoint-url');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'https://rpc.fixture.test');input.dispatchEvent(new Event('input',{bubbles:true})) })()`)
      await evaluate(`document.querySelector('#rpc-apply').click()`)
      await wait('!!document.querySelector("input[name=draft]")')
      assert(await evaluate(`!new URL(location.href).searchParams.has('rpcUrl')`), 'an on-page custom endpoint is not copied into the shared URL')
    }
    await open('public')
    await wait('!!document.querySelector("input[name=draft]")')
    assert(await evaluate(publicView), 'public EVM reads are not presented as a selected account')
    assert(await evaluate(`connectionFixture.state.subjects.every(subject=>subject==='0x0000000000000000000000000000000000000000')&&!new URL(location.href).searchParams.has('account')`), 'the public read subject stays out of the shared account URL')
    assert(await evaluate(`${button}.disabled`), 'even a manifest-exposed transaction is unavailable in public mode')
    await evaluate(`(() => { const draft=document.querySelector('input[name=draft]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(draft,'keep this draft');draft.dispatchEvent(new Event('input',{bubbles:true}));const rpc=document.querySelector('#rpc-endpoint-url');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(rpc,'https://candidate.fixture.test');rpc.dispatchEvent(new Event('input',{bubbles:true}));connectionFixture.state.holdCandidate=true })()`)
    await evaluate(`document.querySelector('#rpc-apply').click()`)
    await wait('connectionFixture.state.candidateStarted')
    assert(await evaluate(`document.querySelector('#rpc-endpoint-url').disabled&&document.querySelector('#rpc-endpoint-choice').disabled`), 'pending RPC validation keeps the visible candidate associated with its result')
    await evaluate('connectionFixture.releaseCandidate()')
    await wait(`!document.querySelector('#rpc-apply').disabled&&!!document.querySelector('.rpc-connection [role="alert"]')`)
    assert(await evaluate(`document.querySelector('input[name=draft]').value==='keep this draft'&&document.querySelector('.rpc-connection').textContent.includes('In use: https://rpc.fixture.test')`), 'a failed candidate keeps the active endpoint and draft')
    await evaluate('connectionFixture.state.failCandidateRead=true;document.querySelector("#rpc-apply").click()')
    await wait(`!document.querySelector('#rpc-apply').disabled&&!!document.querySelector('.rpc-connection [role="alert"]')`)
    assert(await evaluate(`document.querySelector('input[name=draft]').value==='keep this draft'&&document.querySelector('.rpc-connection').textContent.includes('In use: https://rpc.fixture.test')`), 'a failed candidate view refresh rolls back transport without losing its draft')
    const beforeRefresh = await evaluate('connectionFixture.state.readOrigins.length')
    await evaluate(`[...document.querySelectorAll('button')].find(button=>button.textContent==='Refresh').click()`)
    await wait(`connectionFixture.state.readOrigins.length>${beforeRefresh}&&!document.querySelector('#rpc-apply').disabled`)
    assert.equal(await evaluate('connectionFixture.state.readOrigins.at(-1)'), 'https://rpc.fixture.test', 'the next real read after failed candidate refresh uses the original endpoint')
    await evaluate('connectionFixture.state.failCandidateRead=false;document.querySelector("#rpc-apply").click()')
    await wait(`document.querySelector('.rpc-connection').textContent.includes('In use: https://candidate.fixture.test')`)
    assert(await evaluate(`document.querySelector('input[name=draft]').value==='keep this draft'&&!new URL(location.href).searchParams.has('rpcUrl')`), 'successful transport refresh preserves the draft and removes the stale endpoint from the URL')
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
