import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { finishDisplayFixture, navigateBrowserDocument, waitForBrowserCondition, withBrowserFocus } from './escrow-browser-fixture.mjs'
import { assertStableLayout } from './layout-stability.mjs'

export async function checkViewerConnection({ call, evaluate, viewerURL }) {
  const wait = expression => waitForBrowserCondition(() => evaluate(expression), `connection fixture: ${expression}`, Date.now() + 15000)
  async function open(scenario) {
    const url = new URL('/test/connection-fixture.html', viewerURL)
    url.searchParams.set('scenario', scenario)
    await navigateBrowserDocument({ call, url: url.href, description: 'the connection fixture', timeoutMs: 15000,
      ready: () => evaluate('!!window.connectionFixture') })
  }
  async function editRPC(value) {
    await evaluate(`(()=>{const input=document.querySelector('#rpc-endpoint-url');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(value)});input.dispatchEvent(new Event('input',{bubbles:true}))})()`)
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
        await evaluate(`document.querySelector('#app-open').click()`)
        await wait(`!!document.querySelector('.app-setup [role="alert"]')`)
        assert(!(await evaluate(`document.querySelector('.app-setup [role="alert"]').textContent.includes('Cannot use this RPC')`)), 'invalid app coordinates are not reported as an RPC failure')
        assert.equal(await evaluate('connectionFixture.state.subjects.length'), 0, 'invalid app coordinates prevent contract reads')
      }
      await evaluate(`(() => { const choose=document.querySelector('#app-network');choose.value='custom';choose.dispatchEvent(new Event('change',{bubbles:true})) })()`)
      await wait(`!!document.querySelector('#app-chain')`)
      await evaluate(`(() => { for(const [selector,value] of [['#app-chain','eip155:31337'],['#app-host','0x0000000000000000000000000000000000000001']]) { const input=document.querySelector(selector);Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true})) } })()`)
      await wait(`!!document.querySelector('#rpc-endpoint-url')`)
      const document = await call('DOM.getDocument', {})
      const input = await call('DOM.querySelector', { nodeId: document.root.nodeId, selector: '#rpc-endpoint-url' })
      const accessible = await call('Accessibility.getPartialAXTree', { nodeId: input.nodeId, fetchRelatives: false })
      assert(accessible.nodes.some(node => !node.ignored && node.name?.value === 'Custom RPC URL'), 'the custom endpoint retains an accessible input name')
      await evaluate(`(() => { const input=document.querySelector('#rpc-endpoint-url');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'https://rpc.fixture.test');input.dispatchEvent(new Event('input',{bubbles:true})) })()`)
      if (scenario === 'bare') {
        await evaluate(`(() => { const input=document.querySelector('#app-host');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'0x0000000000000000000000000000000000000004');input.dispatchEvent(new Event('input',{bubbles:true})) })()`)
        await evaluate(`document.querySelector('#app-open').click()`)
        await wait(`!!document.querySelector('.panel.error')`)
        await evaluate(`document.querySelector('.wallet-button').click()`)
        await wait(`document.querySelector('.wallet-button')?.textContent==='Reconnect wallet'&&!!document.querySelector('.panel.error')`)
        await evaluate(`[...document.querySelectorAll('button')].find(button=>button.textContent==='Edit app connection').click()`)
        await wait(`!!document.querySelector('#app-host')`)
        assert.equal(await evaluate(`document.querySelector('#app-host').value`), '0x0000000000000000000000000000000000000004', 'failed admission preserves the entered contract address for correction')
        assert.equal(await evaluate(`document.querySelector('#rpc-endpoint-url').value`), 'https://rpc.fixture.test/', 'reopened setup preserves the chosen custom RPC in memory')
        await evaluate(`(() => { const input=document.querySelector('#app-host');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'0x0000000000000000000000000000000000000001');input.dispatchEvent(new Event('input',{bubbles:true})) })()`)
        await evaluate(`(() => { const input=document.querySelector('#app-account');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'');input.dispatchEvent(new Event('input',{bubbles:true})) })()`)
      }
      await evaluate(`document.querySelector('#app-open').click()`)
      await wait(`!!document.querySelector('input[name=draft]')`)
      assert.equal(await evaluate(`document.querySelector('#rpc-endpoint-url').value`), 'https://rpc.fixture.test/', 'the connection controls retain the chosen custom endpoint after setup')
      if (scenario === 'bare') assert(await evaluate(`document.querySelector('.wallet-value').textContent.includes('Not connected')&&document.querySelector('.wallet-button').textContent==='Connect wallet'`), 'reopening setup starts a fresh wallet binding without displaying an old signer')
      assert(await evaluate(`!new URL(location.href).searchParams.has('account')&&!new URL(location.href).searchParams.has('rpcUrl')`), 'opening an app requires neither a viewing account nor a credential-bearing share URL')
    }
    for (const scenario of ['choose-rpc', 'invalid-rpc']) {
      await open(scenario)
      await wait(`!!document.querySelector('#rpc-endpoint-choice')`)
      if (scenario === 'invalid-rpc') assert.equal(await evaluate(`document.querySelector('#rpc-endpoint-url').value`), 'not a URL', 'invalid explicit RPC remains available for correction')
      assert.equal(await evaluate('connectionFixture.state.subjects.length'), 0, 'no RPC read starts without a valid selected endpoint')
      await evaluate(`(() => { const input=document.querySelector('#rpc-endpoint-url');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'https://rpc.fixture.test');input.dispatchEvent(new Event('input',{bubbles:true})) })()`)
      await wait('!!document.querySelector("input[name=draft]")')
      assert(await evaluate(`!new URL(location.href).searchParams.has('rpcUrl')`), 'an on-page custom endpoint is not copied into the shared URL')
    }
    await open('public')
    await wait('!!document.querySelector("input[name=draft]")')
    assert(await evaluate(publicView), 'public EVM reads are not presented as a selected account')
    assert(await evaluate(`connectionFixture.state.subjects.every(subject=>subject==='0x0000000000000000000000000000000000000000')&&!new URL(location.href).searchParams.has('account')`), 'the public read subject stays out of the shared account URL')
    assert(await evaluate(`${button}.disabled`), 'even a manifest-exposed transaction is unavailable in public mode')
    await wait(`!!document.querySelector('[aria-label="RPC connection checked"]')`)
    assert(await evaluate(`!document.querySelector('#rpc-apply')&&!document.querySelector('#rpc-help')&&!document.querySelector('.rpc-connection').textContent.includes('In use:')`), 'live RPC controls have no apply button or redundant status prose')
    await evaluate(`(() => { const draft=document.querySelector('input[name=draft]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(draft,'keep this draft');draft.dispatchEvent(new Event('input',{bubbles:true})) })()`)
    for (const width of [1280, 320]) {
      await call('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false })
      await evaluate('connectionFixture.state.holdPublicRead=true')
      const beforeRefresh = await evaluate('connectionFixture.state.subjects.length')
      await assertStableLayout(evaluate, { connection: '.connection', view: '.ui', draft: 'input[name=draft]' }, async () => {
        await evaluate(`[...document.querySelectorAll('button')].find(button=>button.textContent==='Refresh').click()`)
        await wait(`connectionFixture.state.subjects.length>${beforeRefresh}&&document.querySelector('input[name=draft]').disabled`)
      }, `${width}px view refresh pending`)
      await evaluate('connectionFixture.releasePublicReads()')
      await wait(`!document.querySelector('input[name=draft]').disabled`)
      assert.equal(await evaluate(`document.querySelector('input[name=draft]').value`), 'keep this draft', 'refresh preserves the current draft')
    }
    await call('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false })
    await evaluate('connectionFixture.state.holdCandidate=true')
    await editRPC('https://candidate.fixture.test')
    await wait('connectionFixture.state.candidateStarted')
    assert(await evaluate(`!document.querySelector('#rpc-endpoint-url').disabled&&!document.querySelector('#rpc-endpoint-choice').disabled&&!document.querySelector('[aria-label="RPC connection checked"]')`), 'checking keeps controls editable and never acknowledges an unchecked endpoint')
    await editRPC('https://next.fixture.test')
    await evaluate('new Promise(resolve=>setTimeout(resolve,450))')
    assert(await evaluate(`!document.querySelector('[aria-label="RPC connection checked"]')`), 'the latest draft is not acknowledged while an earlier check is still held')
    await evaluate('connectionFixture.releaseCandidate()')
    await wait(`!!document.querySelector('[aria-label="RPC connection checked"]')&&connectionFixture.state.readOrigins.at(-1)==='https://next.fixture.test'`)
    assert(await evaluate(`!document.querySelector('.rpc-connection [role="alert"]')&&document.querySelector('input[name=draft]').value==='keep this draft'`), 'a late failure cannot report against the newer draft and the queued endpoint is eventually used')
    await evaluate('connectionFixture.state.failCandidateRead=true')
    await editRPC('https://candidate.fixture.test')
    await wait(`!!document.querySelector('.rpc-connection [role="alert"]')&&!document.querySelector('.rpc-connection form').getAttribute('aria-busy').includes('true')`)
    assert(await evaluate(`!document.querySelector('[aria-label="RPC connection checked"]')&&document.querySelector('input[name=draft]').value==='keep this draft'`), 'a failed refresh preserves the form and does not acknowledge its endpoint')
    assert(await evaluate(`(()=>{const input=document.querySelector('#rpc-endpoint-url');const help=document.getElementById(input.getAttribute('aria-describedby'));return !!help?.querySelector('[role="alert"]')})()`), 'the endpoint input describes its connection failure')
    const beforeRefresh = await evaluate('connectionFixture.state.readOrigins.length')
    await evaluate(`(() => { const button=[...document.querySelectorAll('button')].find(button=>button.textContent==='Refresh');button.focus();button.click() })()`)
    await wait(`connectionFixture.state.readOrigins.length>${beforeRefresh}`)
    assert.equal(await evaluate('connectionFixture.state.readOrigins.at(-1)'), 'https://next.fixture.test', 'the next read after a failed candidate refresh still uses the last good endpoint')
    await wait(`!document.querySelector('input[name=draft]').disabled&&document.activeElement===document.querySelector('.ui')`)
    await withBrowserFocus(call, async () => {
      await evaluate('connectionFixture.state.failCandidateRead=false;document.querySelector("#rpc-endpoint-url").focus()')
      await call('Input.dispatchKeyEvent', {type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13,text:'\r',unmodifiedText:'\r'})
      await call('Input.dispatchKeyEvent', {type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13})
      await wait(`!!document.querySelector('[aria-label="RPC connection checked"]')&&connectionFixture.state.readOrigins.at(-1)==='https://candidate.fixture.test'`)
    })
    assert(await evaluate(`document.querySelector('input[name=draft]').value==='keep this draft'&&!new URL(location.href).searchParams.has('rpcUrl')`), 'Enter retries the unchanged endpoint while preserving drafts and URL privacy')
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
    await evaluate(`${button}.click()`)
    await wait(`!!document.querySelector('.prepared-call')`)
    assert(await evaluate(`(()=>{const review=document.querySelector('.prepared-call');return review.textContent.includes('Input: amount (uint256)')&&review.textContent.includes('9007199254740993')&&review.textContent.includes('App action')&&review.textContent.includes('After confirmation')&&!review.querySelector('details')})()`), 'the review shows named exact inputs, app action and next view without a disclosure')
    await evaluate(`[...document.querySelectorAll('button')].find(button=>button.textContent==='Discard transaction').click()`)
    const beforeMissingMetadata = await evaluate('connectionFixture.state.simulations')
    await evaluate(`document.querySelector('button[aria-label="Update metadata"]').click()`)
    await wait(`!!document.querySelector('.notice[role="alert"]')`)
    assert(await evaluate(`!document.querySelector('.prepared-call')&&connectionFixture.state.simulations===${beforeMissingMetadata}&&document.querySelector('.nft-editor [role="alert"]').textContent.includes('Enter a metadata JSON URL')`), 'an initially empty metadata field gives local correction and never reaches simulation')
    await evaluate(`(()=>{const input=document.querySelector('input[name="tokenURI"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'https://metadata.example.test/current.json');input.dispatchEvent(new Event('input',{bubbles:true}))})()`)
    await evaluate(`document.querySelector('button[aria-label="Update metadata"]').click()`)
    await wait(`!!document.querySelector('.prepared-call')`)
    assert(await evaluate(`document.querySelector('.prepared-call').textContent.includes('https://metadata.example.test/current.json')`), 'the visible metadata URL reaches the reviewed call without an apply step')
    await evaluate(`(()=>{const input=document.querySelector('input[name="tokenURI"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'');input.dispatchEvent(new Event('input',{bubbles:true}))})()`)
    const beforeInvalidMetadata = await evaluate('connectionFixture.state.simulations')
    await evaluate(`document.querySelector('button[aria-label="Update metadata"]').click()`)
    await wait(`!!document.querySelector('.notice[role="alert"]')`)
    assert(await evaluate(`!document.querySelector('.prepared-call')&&connectionFixture.state.simulations===${beforeInvalidMetadata}`), 'clearing metadata cannot prepare or simulate the previous URI')
    await evaluate(`[...document.querySelectorAll('.nft-editor [role="tab"]')].find(tab=>tab.textContent==='Embed JSON').click()`)
    await evaluate(`(()=>{const input=document.querySelector('textarea[name="tokenURI.metadata.json"]');input.closest('details').open=true;Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,'{bad JSON}');input.dispatchEvent(new Event('input',{bubbles:true}))})()`)
    await evaluate(`document.querySelector('button[aria-label="Update metadata"]').click()`)
    await wait(`!!document.querySelector('.notice[role="alert"]')`)
    assert(await evaluate(`!document.querySelector('.prepared-call')&&connectionFixture.state.simulations===${beforeInvalidMetadata}&&document.querySelector('.nft-editor [role="alert"]').textContent.includes('use valid JSON')`), 'invalid active JSON is explained locally and never reaches simulation')

    await open('account-required')
    await wait('!!document.querySelector(".panel.error")')
    assert(await evaluate(`!!document.querySelector('.wallet-button')`), 'a route rejecting public reads can still connect a wallet')
    await evaluate('document.querySelector(".wallet-button").click()')
    await wait(`!!document.querySelector('input[name=draft]')&&new URL(location.href).searchParams.get('account')===connectionFixture.wallet`)
    assert(await evaluate(`connectionFixture.listeners.get('accountsChanged')?.size===1`), 'bootstrap recovery keeps one wallet subscription')

    await open('held')
    await wait(`connectionFixture.state.subjects.length===1&&!!document.querySelector('.wallet-button')`)
    assert(await evaluate(`!document.querySelector('[aria-label="RPC connection checked"]')`), 'bootstrap callback completion does not acknowledge a held unfinished connection')
    await evaluate('document.querySelector(".wallet-button").click()')
    await wait(`!!document.querySelector('input[name=draft]')&&new URL(location.href).searchParams.get('account')===connectionFixture.wallet`)
    assert(await evaluate(`!${publicView}`), 'connecting the wallet replaces unfinished public startup with its account view')
    await evaluate('connectionFixture.releasePublicReads()')
    await evaluate('connectionFixture.emit("chainChanged","0xa869")')
    await wait(`document.querySelector('.notice')?.textContent.includes('Wallet network differs')`)
    assert(await evaluate('connectionFixture.state.sends===0'), 'a changed wallet chain never sends during the public-view walkthrough')
    for (const width of [1280, 320]) {
      await call('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false })
      assert(await evaluate('document.documentElement.scrollWidth<=innerWidth'), `connection facts reflow at ${width}px`)
    }
    const warning = `document.querySelector('[aria-label="UI integrity warnings"]')`
    await open('unverified-held')
    await wait(`connectionFixture.state.protocolStarted===1&&!!${warning}`)
    assert(await evaluate(`!document.querySelector('.ui')&&document.querySelector('.panel')?.textContent.includes('Loading app')`), 'the root warning appears while later resources are still loading')
    await evaluate('connectionFixture.releaseProtocol()')
    await wait(`!!document.querySelector('.ui')`)
    assert.equal(await evaluate(`document.querySelectorAll('[aria-label="UI integrity warnings"] [data-kind="warning"]').length`), 1, 'ready replaces progress without duplicating warnings')

    await open('unverified-held')
    await wait(`connectionFixture.state.protocolStarted===1&&!!${warning}`)
    await evaluate('connectionFixture.state.failHeldProtocol=true;connectionFixture.releaseProtocol()')
    await wait(`!!document.querySelector('.panel.error')`)
    assert(await evaluate(`!!${warning}&&${warning}.textContent.includes('Unverified')`), 'a later download failure preserves already known warnings')
    await evaluate(`connectionFixture.state.unverifiedRoot=false;[...document.querySelectorAll('button')].find(button=>button.textContent==='Retry loading').click()`)
    await wait(`!!document.querySelector('.ui')`)
    assert(await evaluate(`!${warning}`), 'retry clears prior-attempt warnings')

    await open('unverified-held')
    await wait(`connectionFixture.state.protocolStarted===1&&!!${warning}`)
    await evaluate('connectionFixture.state.unverifiedRoot=false;connectionFixture.state.holdProtocol=false')
    await editRPC('https://next.fixture.test')
    await wait(`!!document.querySelector('.ui')&&!${warning}`)
    await evaluate('connectionFixture.state.tamperHeldProtocol=true;connectionFixture.releaseProtocol()')
    await wait('connectionFixture.state.protocolCompleted===2')
    await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
    assert(await evaluate(`!!document.querySelector('.ui')&&!${warning}`), 'late warnings from the cancelled load cannot replace the new view')

    await open('unverified')
    await wait(`!!document.querySelector('.ui')`)
    assert(await evaluate(`!!document.querySelector('[aria-label="UI integrity warnings"] [role="status"][data-kind="warning"]')`), 'a zero verification hash produces a warning while the UI remains available')
    assert(await evaluate(`document.querySelector('[aria-label="UI integrity warnings"]').textContent.includes('Unverified')`), 'the unverified condition is stated explicitly')
    assert(await evaluate(`(()=>{const warning=document.querySelector('[aria-label="UI integrity warnings"] [role="status"]');const normal=document.createElement('div');normal.className='error-feedback';normal.dataset.kind='status';document.body.append(normal);const distinct=getComputedStyle(warning).backgroundColor!==getComputedStyle(normal).backgroundColor;normal.remove();return distinct})()`), 'unverified resources do not use the normal status treatment')
    return { publicReadSubject: true, selectedZeroDistinct: true, walletRecovery: true, walletDuringStartup: true, unverifiedWarning: true, earlyIntegrityWarning: true, failedIntegrityRetained: true, staleIntegrityDiscarded: true, sends: 0 }
  } catch (error) { failures.push(error) }
  finally { await finishDisplayFixture({ call, evaluate, viewerURL, failures }) }
}
