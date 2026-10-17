import assert from 'node:assert/strict'

export async function checkTimestampStatus({ call, evaluate, viewerURL }) {
  const fixtureURL = new URL('/test/timestamp-status-fixture.html', viewerURL)
  fixtureURL.search = new URL(viewerURL).search
  async function wait(expression) {
    const deadline = Date.now() + 10000
    while (Date.now() < deadline) {
      if (await evaluate(expression)) return
      await new Promise(resolve => setTimeout(resolve, 50))
    }
    throw new Error(`Timestamp fixture did not reach: ${expression}`)
  }
  async function keyboard(label, key, code, keyCode) {
    assert(await evaluate(`(()=>{const b=[...document.querySelectorAll('.timestamp-options button')].find(b=>b.textContent===${JSON.stringify(label)});if(!b)return false;b.focus();return true})()`))
    await call('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: keyCode })
    await call('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: keyCode })
  }
  try {
    await call('Page.navigate', { url: fixtureURL.href })
    await wait(`document.querySelector('.timestamp-options button[aria-pressed="true"]')?.textContent==='Date'`)
    assert(await evaluate(`window.timestampFixture.activeTimers()===0`))
    await keyboard('Relative', 'Enter', 'Enter', 13)
    await wait(`document.body.innerText.includes('In 20 seconds')&&window.timestampFixture.activeTimers()===1`)
    assert(await evaluate(`document.querySelector('.timestamp-options').getAttribute('role')==='group'&&document.querySelector('.timestamp-options').getAttribute('aria-label')==='Deadline display'&&!document.querySelector('.timestamp-status [aria-live],.timestamp-status [role="status"]')`))
    await evaluate(`window.timestampFixture.setClock(121)`)
    await wait(`document.body.innerText.includes('1 second ago')`)
    await evaluate(`window.timestampFixture.show('140','Deadline','No deadline')`)
    await wait(`document.body.innerText.includes('In 19 seconds')&&window.timestampFixture.activeTimers()===1`)
    await evaluate(`window.timestampFixture.show('140','Other deadline','No deadline')`)
    await wait(`document.querySelector('.timestamp-options button[aria-pressed="true"]')?.textContent==='Date'&&window.timestampFixture.activeTimers()===0`)
    await keyboard('Relative', 'Enter', 'Enter', 13)
    await wait(`window.timestampFixture.activeTimers()===1`)
    await keyboard('Date', ' ', 'Space', 32)
    await wait(`window.timestampFixture.activeTimers()===0`)
    await keyboard('Relative', 'Enter', 'Enter', 13)
    await wait(`window.timestampFixture.activeTimers()===1`)
    await evaluate(`window.timestampFixture.show('0','Other deadline','No deadline')`)
    await wait(`document.body.innerText.includes('No deadline')&&!document.querySelector('.timestamp-options')&&window.timestampFixture.activeTimers()===0`)
    await evaluate(`window.timestampFixture.show('140','Other deadline','No deadline')`)
    await wait(`document.body.innerText.includes('In 19 seconds')&&window.timestampFixture.activeTimers()===1`)
    await evaluate(`window.timestampFixture.hide()`)
    await wait(`!document.querySelector('.timestamp-options')&&window.timestampFixture.activeTimers()===0`)
    await evaluate(`window.timestampFixture.show('0','Epoch',undefined)`)
    await wait(`document.body.innerText.includes('1970-01-01')&&!!document.querySelector('.timestamp-options')`)
    await evaluate(`window.timestampFixture.show('9007199254740993','Large timestamp',undefined)`)
    await wait(`document.body.innerText.includes('9,007,199,254,740,993 Unix seconds')`)
    await keyboard('Relative', 'Enter', 'Enter', 13)
    await wait(`document.body.innerText.includes('In 104,249,991,374 days')`)
    await call('Emulation.setDeviceMetricsOverride', { width: 320, height: 740, deviceScaleFactor: 1, mobile: true })
    assert(await evaluate(`innerWidth===320&&document.documentElement.scrollWidth<=innerWidth&&document.querySelector('input[name="draft"]').value==='unchanged'`))
    return { clockUpdates: true, valueUpdateRetainsMode: true, identityChangeResetsMode: true, absenceAndUnmountCleanup: true, keyboard: true, width: 320 }
  } finally {
    await call('Emulation.clearDeviceMetricsOverride', {})
    await call('Page.navigate', { url: viewerURL })
  }
}
