import assert from 'node:assert/strict'

export async function checkActionStyles({ call, evaluate, viewerURL }) {
  const fixture = new URL('/test/action-style-fixture.html', viewerURL)
  fixture.search = new URL(viewerURL).search
  async function wait(expression) {
    const deadline = Date.now() + 10000
    while (Date.now() < deadline) {
      if (await evaluate(expression)) return
      await new Promise(resolve => setTimeout(resolve, 50))
    }
    throw new Error(`Action fixture did not reach: ${expression}`)
  }
  try {
    await call('Page.navigate', { url: fixture.href })
    await wait(`!!window.actionFixture&&document.querySelectorAll('.elements button').length===6`)
    const native = await evaluate(`(()=>{const buttons=[...document.querySelectorAll('.elements button')];return buttons.every(b=>b.type==='button'&&!b.hasAttribute('href')&&!b.hasAttribute('role'))})()`)
    assert(native, 'CAM actions retain native button semantics')
    await evaluate(`document.querySelectorAll('.elements button')[0].click()`)
    await wait(`window.actionFixture.events.navigate===1`)
    assert(await evaluate(`!document.querySelector('.prepared-call')&&window.actionFixture.events.send===0`), 'read actions never prepare or send')
    await evaluate(`document.querySelectorAll('.elements button')[1].click()`)
    await wait(`!!document.querySelector('.prepared-call')`)
    assert(await evaluate(`window.actionFixture.events.contractCall===1&&window.actionFixture.events.send===0`), 'write actions only prepare review')
    const styles = await evaluate(`(()=>{const [read,write,unknown]=document.querySelectorAll('.elements button'),send=document.querySelector('.send-button'),r=getComputedStyle(read),w=getComputedStyle(write),s=getComputedStyle(send),arrow=read.querySelector('[aria-hidden]');const decorativeArrow=arrow!==null&&arrow.getAttribute('aria-hidden')==='true'&&arrow.textContent.includes('→');return {readQuiet:r.backgroundColor!==s.backgroundColor&&r.borderColor!==s.borderColor,writeOutline:w.backgroundColor!==s.backgroundColor&&w.borderColor===s.borderColor,sendFilled:s.backgroundColor===s.borderColor,arrow:decorativeArrow,unknownNeutral:!unknown.querySelector('[aria-hidden]')&&getComputedStyle(unknown).borderColor!==w.borderColor}})()`)
    assert(styles.readQuiet && styles.writeOutline && styles.sendFilled, 'read, review and send have distinct visual treatments')
    assert(styles.arrow && styles.unknownNeutral, 'only known read actions get a decorative navigation arrow')
    assert(await evaluate(`(()=>{const [read,write,unknown,disabledRead,disabledWrite]=document.querySelectorAll('.elements button');disabledRead.click();disabledWrite.click();read.focus();return document.activeElement===read&&disabledRead.disabled&&disabledWrite.disabled&&window.actionFixture.events.navigate===1&&window.actionFixture.events.contractCall===1})()`), 'disabled actions stay visible and inert; enabled buttons remain focusable')
    await evaluate(`document.querySelectorAll('.elements button')[2].click()`)
    assert(await evaluate(`window.actionFixture.events.unsupported===1&&window.actionFixture.events.send===0`), 'unsupported actions retain their click path without pretending to navigate or send')
    for (const state of ['busy', 'sending']) {
      await evaluate(`window.actionFixture.${state}(true)`)
      await wait(`document.querySelector('.elements').disabled`)
      assert(await evaluate(`(()=>{const before=JSON.stringify(window.actionFixture.events);for(const b of document.querySelectorAll('.elements button')){if(!b.matches(':disabled'))return false;b.click()}return JSON.stringify(window.actionFixture.events)===before})()`), `${state} preserves the fieldset interaction guard`)
      await evaluate(`window.actionFixture.${state}(false)`)
      await wait(`!document.querySelector('.elements').disabled`)
    }
    for (const width of [1280, 320]) {
      await call('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width === 320 })
      const layout = await evaluate(`(()=>{const rows=[...document.querySelectorAll('.elements>.key-value')],values=rows.map(r=>r.lastElementChild.getBoundingClientRect()),bounds=document.querySelector('.elements').getBoundingClientRect();return {overflow:document.documentElement.scrollWidth>innerWidth,aligned:Math.abs(values[0].left-values[1].left)<1,fit:[...document.querySelectorAll('.elements button')].every(b=>b.getBoundingClientRect().right<=bounds.right+1),draft:window.actionFixture.draft(),sends:window.actionFixture.events.send}})()`)
      assert(!layout.overflow && layout.aligned && layout.fit, 'action labels wrap without overflowing or shifting neighboring Status values')
      assert.equal(layout.draft, 'unchanged')
      assert.equal(layout.sends, 0)
    }
    return { widths: [1280, 320], readReviewSendDistinct: true, disabledAndBusyPreserved: true, nativeKeyboardUnverified: true }
  } finally {
    await call('Emulation.clearDeviceMetricsOverride', {})
    await call('Page.navigate', { url: viewerURL })
  }
}
