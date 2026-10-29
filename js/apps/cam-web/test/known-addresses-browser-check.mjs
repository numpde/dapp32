import assert from 'node:assert/strict'
import { navigateBrowserDocument, waitForBrowserCondition, finishDisplayFixture } from './escrow-browser-fixture.mjs'

export async function checkAddressEntry({ call, evaluate, viewerURL }) {
  const fixture = new URL('/test/connection-fixture.html?scenario=addresses', viewerURL)
  const wait = expression => waitForBrowserCondition(() => evaluate(expression), `address entry: ${expression}`)
  const failures = []
  try {
    await navigateBrowserDocument({ call, url: fixture.href, description: 'the address-entry fixture', ready: () => evaluate('!!window.connectionFixture') })
    return await checkKnownAddresses({ call, evaluate, wait })
  } catch (error) { failures.push(error) }
  finally { await finishDisplayFixture({ call, evaluate, viewerURL, failures }) }
}

async function checkKnownAddresses({ call, evaluate, wait }) {
  const field = name => `document.querySelector('input[name="${name}"]')`
  const input = field('arbitrator')
  const trigger = `document.querySelector('button[aria-label="Use a known address for arbitrator"]')`
  const popup = `document.querySelector('.address-popover')`
  const options = `[...${popup}.querySelectorAll('[role=option]')].map(option=>({value:option.querySelector('code').title,label:option.getAttribute('aria-label')}))`
  const alice = '0x1111111111111111111111111111111111111111'
  const bob = '0x2222222222222222222222222222222222222222'
  const entered = '0x7777777777777777777777777777777777777777'
  async function key(name, code, number) {
    await call('Input.dispatchKeyEvent', { type: 'keyDown', key: name, code, windowsVirtualKeyCode: number })
    await call('Input.dispatchKeyEvent', { type: 'keyUp', key: name, code, windowsVirtualKeyCode: number })
  }
  async function click(expression) {
    const point = await evaluate(`(()=>{const element=${expression};element.scrollIntoView({block:'nearest'});const r=element.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}})()`)
    await call('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...point })
    await call('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...point })
  }
  async function open() {
    await click(trigger)
    await wait(`${input}.getAttribute('aria-expanded')==='true'&&!!${popup}`)
  }
  async function close() {
    await key('Escape', 'Escape', 27)
    await wait(`${input}.getAttribute('aria-expanded')==='false'&&!${popup}`)
  }
  async function choices() {
    await open()
    const result = await evaluate(options)
    await close()
    return result
  }
  async function edit(name, value) {
    await evaluate(`(()=>{const input=${field(name)};input.focus();Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(value)});input.dispatchEvent(new Event('input',{bubbles:true}))})()`)
    await wait(`${field(name)}.value===${JSON.stringify(value)}`)
  }
  await wait(`!!${field('contractor')}`)
  const initial = await choices()
  assert(initial.some(option => option.value === alice && option.label.includes('Current view: Owner')))
  assert(initial.some(option => option.label.includes('Loaded contract: contracts.App')))
  assert(!initial.some(option => option.label.includes('Entered in:')), 'programmatic defaults are never learned')
  await edit('draft', bob)
  await evaluate(`${field('draft')}.blur()`)
  assert(!(await choices()).some(option => option.value === bob), 'untyped address-looking text is not learned')
  await edit('contractor', entered)
  await evaluate(`${field('contractor')}.blur()`)
  assert((await choices()).some(option => option.value === entered && option.label.includes('Entered in: contractor')))
  assert.equal(await evaluate(`${input}.value`), `0x${'0'.repeat(40)}`, 'learning does not overwrite another field')
  await evaluate(`document.querySelector('.wallet-button').click()`)
  await wait(`document.querySelector('.wallet-button').textContent==='Reconnect wallet'`)
  assert((await choices()).some(option => option.label.includes('Signing wallet')))
  await evaluate(`document.querySelector('button[aria-label="Update record"]').click()`)
  await wait(`!!document.querySelector('.prepared-call')`)
  await open()
  await key('ArrowDown', 'ArrowDown', 40)
  await close()
  assert(await evaluate(`!!document.querySelector('.prepared-call')&&${input}.value==='0x${'0'.repeat(40)}'`), 'opening, browsing and cancelling do not change a value or discard its review')
  await open()
  await click(`${popup}.querySelector('code[title="${entered}"]').closest('[role=option]')`)
  await wait(`${input}.value===${JSON.stringify(entered)}&&!document.querySelector('.prepared-call')`)
  await evaluate(`document.querySelector('button[aria-label="Next view"]').click()`)
  await wait(`document.querySelector('h1').textContent==='Connection detail'`)
  const afterNavigation = await choices()
  assert(afterNavigation.some(option => option.value === entered), 'manual entries survive navigation')
  assert(afterNavigation.some(option => option.value === bob && option.label.includes('Current view: Owner')))
  assert(!afterNavigation.some(option => option.value === alice), 'old current-view roles are not retained')
  for (const width of [1280, 320]) {
    await call('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false })
    await edit('arbitrator', `0x${'0'.repeat(40)}`)
    await evaluate(`${input}.scrollIntoView({block:'end'})`)
    await open()
    const geometry = await evaluate(`(()=>{const menu=${popup},list=menu.querySelector('[role=listbox]'),bar=${input}.closest('.address-control');const a=bar.getBoundingClientRect(),b=menu.getBoundingClientRect();return {fits:b.left>=0&&b.right<=innerWidth&&b.top>=0&&b.bottom<=innerHeight,wholeField:Math.abs(a.width-b.width)<2,flipped:menu.dataset.side==='top',labelsFit:[...list.children].every(option=>option.scrollWidth<=option.clientWidth),noPageOverflow:document.documentElement.scrollWidth<=innerWidth}})()`)
    assert(geometry.fits && geometry.wholeField && geometry.flipped && geometry.labelsFit && geometry.noPageOverflow, 'the opened popup fits the viewport, anchors to the full field and flips above its bottom-edge trigger')
    await key('ArrowUp', 'ArrowUp', 38)
    await wait(`(()=>{const id=${input}.getAttribute('aria-activedescendant');return document.getElementById(id)?.querySelector('code')?.title===${JSON.stringify(entered)}})()`)
    assert.equal(await evaluate(`${input}.value`), `0x${'0'.repeat(40)}`, 'highlighting an option does not commit it')
    await key('Enter', 'Enter', 13)
    await wait(`${input}.value===${JSON.stringify(entered)}&&!${popup}`)
    await evaluate(`${input}.blur()`)
    await wait(`!!${input}.closest('.address-control').querySelector('.address-display')`)
    assert(await evaluate(`${input}.closest('.address-control').querySelector('.address-display code').textContent===${JSON.stringify(entered)}`), 'the compact display retains the exact identifier once')
    await evaluate(`${input}.focus()`)
    await wait(`!${input}.closest('.address-control').querySelector('.address-display')`)
    const doc = await call('DOM.getDocument', {})
    const inputSelector = 'input[name=arbitrator]'
    const node = await call('DOM.querySelector', { nodeId: doc.root.nodeId, selector: inputSelector })
    const ax = await call('Accessibility.getPartialAXTree', { nodeId: node.nodeId, fetchRelatives: false })
    assert(ax.nodes.some(node => !node.ignored && node.role?.value === 'combobox' && node.name?.value === 'arbitrator' && node.value?.value === entered), 'one editable combobox exposes the full value to accessibility')
  }
  await edit('arbitrator', '0xabc')
  await evaluate(`${input}.blur()`)
  assert.equal(await evaluate(`${input}.value`), '0xabc', 'custom incomplete text is not silently replaced on blur')
  await evaluate('connectionFixture.state.holdPublicRead=true')
  const beforeRefresh = await evaluate('connectionFixture.state.subjects.length')
  await evaluate(`[...document.querySelectorAll('.ui-meta>button')].find(button=>button.textContent==='Refresh').click()`)
  await wait(`connectionFixture.state.subjects.length>${beforeRefresh}&&${field('contractor')}.disabled`)
  assert(await evaluate(`${trigger}.disabled`), 'busy views block typing and suggestion selection')
  await evaluate('connectionFixture.releasePublicReads()')
  await wait(`!${field('contractor')}.disabled`)
  assert((await choices()).some(option => option.value === entered), 'refresh retains entered suggestions')
  assert.equal(await evaluate('connectionFixture.state.sends'), 0)
  return { knownAddresses: true, editableCombobox: true, openedPopupFits: true, bottomEdgeFlip: true, keyboardCommit: true, escapePreservesReview: true, paymentWrites: 0 }
}
