import assert from 'node:assert/strict'
import { navigateBrowserDocument, waitForBrowserCondition, finishDisplayFixture } from './escrow-browser-fixture.mjs'

export async function checkChoiceField({ call, evaluate, viewerURL }) {
  const fixture = new URL('/test/connection-fixture.html?scenario=choices', viewerURL)
  const wait = expression => waitForBrowserCondition(() => evaluate(expression), `choice field: ${expression}`)
  const select = `document.querySelector('select[name="recipient"]')`
  const failures = []
  try {
    await navigateBrowserDocument({ call, url: fixture.href, description: 'the choice-field fixture', ready: () => evaluate(`!!${select}`) })
    assert.deepEqual(await evaluate(`Array.from(${select}.options).map(option=>[option.value,option.textContent])`), [['1', 'Client'], ['2', 'Contractor']])
    assert(await evaluate(`${select}.labels[0].textContent.includes('Arbitration timeout recipient')`))
    assert(await evaluate(`document.querySelector('select[name="disabledRecipient"]').disabled`))
    for (const width of [1280, 320]) {
      await call('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false })
      await evaluate(`${select}.value='1';${select}.dispatchEvent(new Event('change',{bubbles:true}))`)
      await wait(`${select}.value==='1'`)
      await evaluate(`${select}.focus()`)
      await call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'End', code: 'End', windowsVirtualKeyCode: 35 })
      await call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'End', code: 'End', windowsVirtualKeyCode: 35 })
      await wait(`${select}.value==='2'`)
      assert(await evaluate('document.documentElement.scrollWidth<=innerWidth'), 'choice control fits its viewport')
    }
    await evaluate('connectionFixture.state.holdPublicRead=true')
    const reads = await evaluate('connectionFixture.state.subjects.length')
    await evaluate(`[...document.querySelectorAll('.ui-meta>button')].find(button=>button.textContent==='Refresh').click()`)
    await wait(`connectionFixture.state.subjects.length>${reads}&&${select}.disabled`)
    await evaluate('connectionFixture.releasePublicReads()')
    await wait(`!${select}.disabled&&${select}.value==='2'`)
    assert.equal(await evaluate('connectionFixture.state.sends'), 0)
    return { choiceField: true, nativeKeyboard: true, disabledAndBusy: true, refreshRetainsChoice: true, paymentWrites: 0 }
  } catch (error) { failures.push(error) }
  finally { await finishDisplayFixture({ call, evaluate, viewerURL, failures }) }
}
