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
  async function checkLayout(narrow) {
    const layout = await evaluate(`(()=>{const rows=[...document.querySelectorAll('.elements > .key-value')],values=rows.map(row=>row.lastElementChild.getBoundingClientRect()),row=rows[1],control=row?.querySelector('.timestamp-options');let pill=true;if(control){const parts=[...control.querySelectorAll('[data-mode]')].map(p=>p.getBoundingClientRect()),r=control.getBoundingClientRect();pill=parts.length===2&&Math.abs(parts[0].right-parts[1].left)<=2&&r.width>=56&&r.height>=28&&!!control.getAttribute('aria-describedby')&&getComputedStyle(control).overflowX!=='hidden'&&getComputedStyle(control).overflowY!=='hidden'}return {count:rows.length,aligned:values.every(v=>Math.abs(v.left-values[0].left)<1),fullWidth:values.every((v,i)=>v.width>=rows[i].getBoundingClientRect().width-2),pill,overflow:document.documentElement.scrollWidth>innerWidth}})()`)
    assert.equal(layout.count, 3, 'timestamp layout is measured between ordinary Status rows')
    assert(layout.aligned, 'timestamp values align with the neighboring Status values')
    assert(layout.pill && !layout.overflow, 'timestamp control remains usable without clipping or overflow')
    if (narrow) assert(layout.fullWidth, 'stacked values share the full row width')
  }
  async function checkNeighborAlignment() {
    for (const width of [1280, 761, 760, 320]) {
      await call('Emulation.setDeviceMetricsOverride', { width, height: 740, deviceScaleFactor: 1, mobile: width === 320 })
      for (const [value, label, absent] of [['120', 'At', false], ['120', 'A longer timestamp field label that must wrap within its own cell', false], ['0', 'No active request', true]]) {
        await evaluate(`window.timestampFixture.show(${JSON.stringify(value)},${JSON.stringify(label)},'No deadline')`)
        await wait(`document.querySelectorAll('.elements > .key-value').length===3&&[...document.querySelectorAll('.elements .key-label')].some(l=>l.textContent===${JSON.stringify(label)})`)
        await checkLayout(width <= 760)
        if (!absent) {
          await evaluate(`document.querySelector('button.timestamp-options').click()`)
          await wait(`document.querySelector('button.timestamp-options').getAttribute('aria-pressed')==='true'`)
          await checkLayout(width <= 760)
        }
      }
    }
  }
  async function keyboard(key, code, keyCode) {
    assert(await evaluate(`(()=>{const b=document.querySelector('button.timestamp-options');if(!b)return false;b.focus();return true})()`))
    const text = key === 'Enter' ? '\r' : key
    await call('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: keyCode, text, unmodifiedText: text })
    await call('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: keyCode })
  }
  try {
    await call('Page.navigate', { url: fixtureURL.href })
    await wait(`!!document.querySelector('.timestamp-options')`)
    assert(await evaluate(`(()=>{const b=document.querySelector('.timestamp-options');return b.tagName==='BUTTON'&&!b.querySelector('button,input,a')&&b.getAttribute('aria-label')==='Relative time for Deadline'&&b.getAttribute('aria-pressed')==='false'})()`), 'one native button owns the entire timestamp pill')
    assert(await evaluate(`window.timestampFixture.activeTimers()===0`))
    await checkNeighborAlignment()
    await call('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false })
    await evaluate(`window.timestampFixture.show('120','Deadline','No deadline')`)
    await wait(`document.querySelector('button.timestamp-options')?.getAttribute('aria-pressed')==='false'`)
    for (const [selector, pressed] of [['[data-mode="date"]', 'true'], ['[data-mode="relative"]', 'false'], [null, 'true'], [null, 'false']]) {
      await evaluate(`(()=>{const button=document.querySelector('.timestamp-options');const target=${selector === null ? 'button' : `button.querySelector(${JSON.stringify(selector)})`};target.click()})()`)
      await wait(`document.querySelector('.timestamp-options').getAttribute('aria-pressed')===${JSON.stringify(pressed)}`)
    }
    await keyboard('Enter', 'Enter', 13)
    await wait(`document.body.innerText.includes('In 20 seconds')&&window.timestampFixture.activeTimers()===1`)
    assert(await evaluate(`(()=>{const b=document.querySelector('.timestamp-options');return b.getAttribute('aria-label')==='Relative time for Deadline'&&[...b.querySelectorAll('[data-mode]')].every(s=>s.getAttribute('aria-hidden')==='true'&&s.title&&s.querySelector('svg'))&&!document.querySelector('.timestamp-status [aria-live],.timestamp-status [role="status"]')})()`))
    assert(await evaluate(`(()=>{const row=document.querySelector('.timestamp-status'),control=row.querySelector('.timestamp-options'),value=row.lastElementChild,id=control.getAttribute('aria-describedby'),hint=document.getElementById(id),r=hint?.getBoundingClientRect();return value.getAttribute('aria-describedby')===id&&hint.textContent==='Relative to your device clock.'&&r.width<=1&&r.height<=1})()`), 'relative clock help describes the value and control without a visible paragraph')
    await evaluate(`window.timestampFixture.setClock(121)`)
    await wait(`document.body.innerText.includes('1 second ago')`)
    await evaluate(`window.timestampFixture.show('140','Deadline','No deadline')`)
    await wait(`document.body.innerText.includes('In 19 seconds')&&window.timestampFixture.activeTimers()===1`)
    await evaluate(`window.timestampFixture.show('140','Other deadline','No deadline')`)
    await wait(`document.querySelector('.timestamp-options')?.getAttribute('aria-pressed')==='false'&&window.timestampFixture.activeTimers()===0`)
    await keyboard('Enter', 'Enter', 13)
    await wait(`window.timestampFixture.activeTimers()===1`)
    await keyboard(' ', 'Space', 32)
    await wait(`window.timestampFixture.activeTimers()===0`)
    await keyboard('Enter', 'Enter', 13)
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
    await keyboard('Enter', 'Enter', 13)
    await wait(`document.body.innerText.includes('In 104,249,991,374 days')`)
    await call('Emulation.setDeviceMetricsOverride', { width: 320, height: 740, deviceScaleFactor: 1, mobile: true })
    await checkLayout(true)
    assert(await evaluate(`innerWidth===320&&document.documentElement.scrollWidth<=innerWidth&&document.querySelector('input[name="draft"]').value==='unchanged'`))
    return { wholePillToggles: true, clockUpdates: true, valueUpdateRetainsMode: true, identityChangeResetsMode: true, absenceAndUnmountCleanup: true, keyboard: true, width: 320 }
  } finally {
    await call('Emulation.clearDeviceMetricsOverride', {})
    await call('Page.navigate', { url: viewerURL })
  }
}
