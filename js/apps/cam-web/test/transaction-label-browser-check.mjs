import assert from 'node:assert/strict'
import { navigateBrowserDocument, waitForBrowserCondition, finishDisplayFixture } from './escrow-browser-fixture.mjs'

export async function checkTransactionLabels({ call, evaluate, viewerURL }) {
  const wait = expression => waitForBrowserCondition(() => evaluate(expression), `transaction labels: ${expression}`)
  const outcome = `document.querySelector('.transaction-feedback')`
  const hash = `0x${'ab'.repeat(32)}`
  const failures = []
  try {
    for (const scenario of ['transaction-label', 'transaction-label-unknown', 'transaction-label-retry', 'transaction-label-retry-revert']) {
      const fixture = new URL(`/test/connection-fixture.html?scenario=${scenario}`, viewerURL)
      await navigateBrowserDocument({ call, url: fixture.href, description: 'the transaction-label fixture', ready: () => evaluate('!!document.querySelector("input[name=draft]")') })
      await call('Emulation.setDeviceMetricsOverride', { width: 320, height: 256, deviceScaleFactor: 1, mobile: false })
      await evaluate(`document.querySelector('.wallet-button').click()`)
      await wait(`document.querySelector('button[aria-label="Update record"]')?.disabled===false`)
      if (scenario === 'transaction-label-retry') {
        await evaluate(`document.querySelector('button[aria-label="Next view"]').click()`)
        await wait(`document.querySelector('h1').textContent==='Connection detail'`)
      }
      await evaluate(`document.querySelector('button[aria-label="Update record"]').click()`)
      await wait(`document.activeElement === document.querySelector('.prepared-call')`)
      const reviewBounds = await evaluate(`(()=>{const r=document.querySelector('.prepared-call').getBoundingClientRect();return {top:r.top,height:r.height,viewport:innerHeight}})()`)
      assert(reviewBounds.height > reviewBounds.viewport && reviewBounds.top >= -1 && reviewBounds.top < reviewBounds.viewport, `a tall review arrives with its beginning visible: ${JSON.stringify(reviewBounds)}`)
      if (scenario === 'transaction-label-unknown') await evaluate(`(()=>{const style=document.createElement('style');style.id='arrival-test-size';style.textContent='.transaction-feedback .feedback-message { min-height: 500px }';document.head.append(style)})()`)
      await evaluate(`document.querySelector('.send-button').click()`)
      if (scenario === 'transaction-label') {
        await wait(`${outcome}?.textContent.includes('Transaction submitted.')`)
        assert(await evaluate(`${outcome}.textContent.includes('Update record:')&&${outcome}.querySelector('.hex-value code').textContent===${JSON.stringify(hash)}`))
        await evaluate(`connectionFixture.emit('accountsChanged',['0x5555555555555555555555555555555555555555'])`)
        await wait(`document.querySelector('.wallet-value code')?.textContent==='0x5555555555555555555555555555555555555555'`)
        await evaluate('connectionFixture.releaseReceipt()')
        await wait(`${outcome}.textContent.includes('Transaction confirmed in block 16.')`)
        assert.equal(await evaluate('connectionFixture.state.transactionLookups'), 0, 'a transaction lookup miss cannot prevent receipt tracking')
      } else if (scenario.startsWith('transaction-label-retry')) {
        const retry = `${outcome}.querySelector('.transaction-feedback-actions > button:not(.button-quiet)')`
        await wait(`${outcome}?.textContent.includes('confirmation could not be checked')&&${retry}?.disabled===false`)
        assert(await evaluate(`(()=>{const [check,dismiss]=Array.from(${outcome}.querySelectorAll('.transaction-feedback-actions > button'),button=>button.getBoundingClientRect());return check.right<=dismiss.left&&Math.abs((check.top+check.bottom-dismiss.top-dismiss.bottom)/2)<1&&dismiss.right<=innerWidth})()`), 'check and dismiss align in action order without overflowing a narrow screen')
        if (scenario === 'transaction-label-retry-revert') {
          await evaluate(`connectionFixture.state.failAccountRead=true;connectionFixture.emit('accountsChanged',['0x5555555555555555555555555555555555555555'])`)
          await wait(`document.querySelector('main > .notice')?.textContent.includes('Cannot synchronize')&&!document.querySelector('.wallet-value code')&&document.querySelector('.wallet-button').disabled===false&&document.querySelector('button[aria-label="Next view"]').disabled===true`)
          assert(await evaluate(`${retry}.disabled===false`), 'receipt recovery remains available after wallet account synchronization fails')
        }
        const failedRequests = await evaluate('connectionFixture.state.receiptRequests')
        await evaluate(`${retry}.click();${retry}.click()`)
        await wait(`connectionFixture.state.receiptRequests>${failedRequests}&&${outcome}.textContent.includes('confirmation could not be checked')&&${retry}.disabled===false`)
        assert.equal(await evaluate('connectionFixture.state.sends'), 1, 'repeated receipt failures and retry clicks never resubmit to the wallet')
        if (scenario === 'transaction-label-retry-revert') {
          await evaluate(`connectionFixture.state.failAccountRead=false;document.querySelector('.wallet-button').click()`)
          await wait(`document.querySelector('button[aria-label="Next view"]').disabled===false`)
        }
        await evaluate(`document.querySelector('button[aria-label="Update another record"]').click()`)
        await wait(`!!document.querySelector('.prepared-call')`)
        const preflight = await evaluate('({reviews:connectionFixture.state.reviews,simulations:connectionFixture.state.simulations})')
        await evaluate('connectionFixture.state.failReceipt=false;connectionFixture.holdReceipt()')
        const requests = await evaluate('connectionFixture.state.receiptRequests')
        await evaluate(`${retry}.click();${retry}.click()`)
        await wait(`connectionFixture.state.receiptRequests>${requests}`)
        assert(await evaluate(`${retry}.disabled&&${outcome}.querySelector('.button-quiet').disabled`), 'checking has one in-flight owner and cannot be dismissed before it settles')
        assert.equal(await evaluate('connectionFixture.state.receiptRequests'), requests + 1, 'rapid repeat activation starts only one receipt request')
        assert(await evaluate(`document.querySelector('.send-button').disabled&&document.querySelector('.send-button').textContent==='Send with wallet'`), 'checking an earlier transaction cannot present an unrelated prepared call as submitted')
        await evaluate('connectionFixture.releaseReceipt()')
        await wait(`${outcome}.textContent.includes(${JSON.stringify(scenario === 'transaction-label-retry-revert' ? 'Transaction reverted.' : 'Transaction confirmed in block 16.')})`)
        await wait(`${outcome}.querySelector('.button-quiet').disabled===false`)
        assert(await evaluate(`!!document.querySelector('.prepared-call')&&!${retry}`), 'a settled receipt removes retry without erasing an unrelated prepared review')
        assert.deepEqual(await evaluate('({reviews:connectionFixture.state.reviews,simulations:connectionFixture.state.simulations})'), preflight, 'checking confirmation does not repeat preflight')
        assert(await evaluate(`Array.from(document.querySelectorAll('.prepared-call dl')).find(row=>row.querySelector('dt')?.textContent==='Input: amount (uint256)')?.querySelector('dd')?.textContent==='42'&&!document.querySelector('.send-button').disabled&&!document.querySelector('.prepared-call .button-quiet').disabled`), 'the unrelated review and its send/discard controls remain available after receipt checking')
        assert.equal(await evaluate(`document.querySelector('h1').textContent`), scenario === 'transaction-label-retry' ? 'Connection detail' : 'Connection fixture', 'retry stays on the current screen')
      } else {
        await wait(`${outcome}?.textContent.includes('may have been sent')`)
        await wait(`document.activeElement===document.querySelector('.transaction-feedback .feedback-message')`)
        assert(await evaluate(`(()=>{const r=document.activeElement.getBoundingClientRect();return r.height>innerHeight&&r.top>=-1&&r.top<innerHeight})()`), 'a tall transaction outcome arrives with its beginning visible')
        await evaluate(`document.querySelector('#arrival-test-size').remove()`)
        assert(await evaluate(`!${outcome}.querySelector('.hex-value code')`), 'an uncertain submission has no invented hash')
        assert(await evaluate(`Array.from(${outcome}.querySelectorAll('button')).every(button=>button.textContent!=='Check confirmation')`), 'a missing hash cannot offer a confirmation retry')
      }
      await wait(`document.querySelector('button[aria-label="Update another record"]')?.disabled===false`)
      await evaluate(`document.querySelector('button[aria-label="Update another record"]').click()`)
      await wait(`!!document.querySelector('.prepared-call')`)
      assert(await evaluate(`${outcome}.textContent.includes('Update record:')&&!${outcome}.textContent.includes('Update another record')`), 'a later preparation cannot relabel a retained submitted or uncertain outcome')
      if (scenario === 'transaction-label') assert(await evaluate(`${outcome}.querySelector('.hex-value code').textContent===${JSON.stringify(hash)}`))
      assert.equal(await evaluate('connectionFixture.state.sends'), 1, 'preparing the next review makes no second wallet request')
      if (scenario === 'transaction-label') {
        await evaluate(`${outcome}.querySelector('.transaction-feedback-actions .button-quiet').click()`)
        await wait(`!${outcome}`)
      } else if (scenario === 'transaction-label-retry') {
        await evaluate('history.back()')
        await wait(`document.querySelector('h1').textContent==='Connection fixture'&&!${outcome}`)
        await evaluate('history.forward()')
        await wait(`document.querySelector('h1').textContent==='Connection detail'&&!${outcome}`)
      } else {
        await evaluate('connectionFixture.state.failAccountRead=true')
        await evaluate(`document.querySelector('button[aria-label="Next view"]').click()`)
        await wait(`!!document.querySelector('main > .notice[role="alert"]')&&document.querySelector('button[aria-label="Next view"]').disabled===false`)
        assert(await evaluate(`!!${outcome}`), 'failed navigation keeps the transaction feedback')
        await evaluate('connectionFixture.state.failAccountRead=false')
        await evaluate(`document.querySelector('button[aria-label="Next view"]').click()`)
        await wait(`document.querySelector('h1').textContent==='Connection detail'&&!${outcome}`)
        await evaluate('history.back()')
        await wait(`document.querySelector('h1').textContent==='Connection fixture'&&!${outcome}`)
      }
      assert.equal(await evaluate('connectionFixture.state.sends'), 1, 'dismissal, navigation and confirmation checks never submit another transaction')
    }
    return { tallReviewArrival: true, retainedActionIdentity: true, lateConfirmation: true, uncertainSubmissionIdentity: true, receiptRetry: true, retryAfterWalletSyncFailure: true, retryRevert: true, dismissAndNavigate: true, syntheticWalletRequests: 4, realTransactions: 0 }
  } catch (error) { failures.push(error) }
  finally {
    try { await call('Emulation.clearDeviceMetricsOverride', {}) } catch (error) { failures.push(error) }
    await finishDisplayFixture({ call, evaluate, viewerURL, failures })
  }
}
