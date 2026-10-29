import assert from 'node:assert/strict'
import { navigateBrowserDocument, waitForBrowserCondition, finishDisplayFixture } from './escrow-browser-fixture.mjs'

export async function checkTransactionLabels({ call, evaluate, viewerURL }) {
  const wait = expression => waitForBrowserCondition(() => evaluate(expression), `transaction labels: ${expression}`)
  const outcome = `document.querySelector('.transaction-feedback')`
  const hash = `0x${'ab'.repeat(32)}`
  const failures = []
  try {
    for (const scenario of ['transaction-label', 'transaction-label-unknown']) {
      const fixture = new URL(`/test/connection-fixture.html?scenario=${scenario}`, viewerURL)
      await navigateBrowserDocument({ call, url: fixture.href, description: 'the transaction-label fixture', ready: () => evaluate('!!document.querySelector("input[name=draft]")') })
      await evaluate(`document.querySelector('.wallet-button').click()`)
      await wait(`document.querySelector('button[aria-label="Update record"]')?.disabled===false`)
      await evaluate(`document.querySelector('button[aria-label="Update record"]').click()`)
      await wait(`!!document.querySelector('.prepared-call')`)
      await evaluate(`document.querySelector('.send-button').click()`)
      if (scenario === 'transaction-label') {
        await wait(`${outcome}?.textContent.includes('Transaction submitted.')`)
        assert(await evaluate(`${outcome}.textContent.includes('Update record:')&&${outcome}.querySelector('.hex-value code').textContent===${JSON.stringify(hash)}`))
        await evaluate(`connectionFixture.emit('accountsChanged',['0x5555555555555555555555555555555555555555'])`)
        await wait(`document.querySelector('.wallet-value code')?.textContent==='0x5555555555555555555555555555555555555555'`)
        await evaluate('connectionFixture.releaseReceipt()')
        await wait(`${outcome}.textContent.includes('Transaction confirmed in block 16.')`)
      } else {
        await wait(`${outcome}?.textContent.includes('may have been sent')`)
        assert(await evaluate(`!${outcome}.querySelector('.hex-value code')`), 'an uncertain submission has no invented hash')
      }
      await wait(`document.querySelector('button[aria-label="Update another record"]')?.disabled===false`)
      await evaluate(`document.querySelector('button[aria-label="Update another record"]').click()`)
      await wait(`!!document.querySelector('.prepared-call')`)
      assert(await evaluate(`${outcome}.textContent.includes('Update record:')&&!${outcome}.textContent.includes('Update another record')`), 'a later preparation cannot relabel a retained submitted or uncertain outcome')
      if (scenario === 'transaction-label') assert(await evaluate(`${outcome}.querySelector('.hex-value code').textContent===${JSON.stringify(hash)}`))
      assert.equal(await evaluate('connectionFixture.state.sends'), 1, 'preparing the next review makes no second wallet request')
    }
    return { retainedActionIdentity: true, lateConfirmation: true, uncertainSubmissionIdentity: true, syntheticWalletRequests: 2, realTransactions: 0 }
  } catch (error) { failures.push(error) }
  finally { await finishDisplayFixture({ call, evaluate, viewerURL, failures }) }
}
