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
  const select = `document.querySelector('select[aria-label="Use a known address for arbitrator"]')`
  const options = `Array.from(${select}.options).map(option=>({value:option.value,label:option.textContent}))`
  const alice = '0x1111111111111111111111111111111111111111'
  const bob = '0x2222222222222222222222222222222222222222'
  const entered = '0x7777777777777777777777777777777777777777'
  async function edit(name, value) {
    await evaluate(`(()=>{const input=${field(name)};input.focus();Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(value)});input.dispatchEvent(new Event('input',{bubbles:true}))})()`)
    await wait(`${field(name)}.value===${JSON.stringify(value)}`)
  }
  await wait(`!!${field('contractor')}`)
  const initial = await evaluate(options)
  assert(initial.some(option => option.value === alice && option.label.includes('Current view: Owner')))
  assert(initial.some(option => option.label.includes('Loaded contract: contracts.App')))
  assert(!initial.some(option => option.label.includes('Entered in:')), 'programmatic defaults are never learned')
  await edit('draft', bob)
  await evaluate(`${field('draft')}.blur()`)
  assert(!(await evaluate(options)).some(option => option.value === bob), 'untyped address-looking text is not learned')
  await edit('contractor', entered)
  await evaluate(`${field('contractor')}.blur()`)
  await wait(`${options}.some(option=>option.value===${JSON.stringify(entered)}&&option.label.includes('Entered in: contractor'))`)
  assert.equal(await evaluate(`${field('arbitrator')}.value`), `0x${'0'.repeat(40)}`, 'learning does not overwrite another field')
  await evaluate(`document.querySelector('.wallet-button').click()`)
  await wait(`${options}.some(option=>option.label.includes('Signing wallet'))`)
  await evaluate(`document.querySelector('button[aria-label="Update record"]').click()`)
  await wait(`!!document.querySelector('.prepared-call')`)
  await evaluate(`${select}.value=${JSON.stringify(entered)};${select}.dispatchEvent(new Event('change',{bubbles:true}))`)
  await wait(`${field('arbitrator')}.value===${JSON.stringify(entered)}&&!document.querySelector('.prepared-call')`)
  await evaluate(`document.querySelector('button[aria-label="Next view"]').click()`)
  await wait(`document.querySelector('h1').textContent==='Connection detail'`)
  const afterNavigation = await evaluate(options)
  assert(afterNavigation.some(option => option.value === entered), 'manual entries survive navigation')
  assert(afterNavigation.some(option => option.value === bob && option.label.includes('Current view: Owner')))
  assert(!afterNavigation.some(option => option.value === alice), 'an old current-view role does not become historical authority')
  for (const width of [1280, 320]) {
    await call('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false })
    await edit('arbitrator', `0x${'0'.repeat(40)}`)
    await evaluate(`${select}.focus()`)
    await call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'End', code: 'End', windowsVirtualKeyCode: 35 })
    await call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'End', code: 'End', windowsVirtualKeyCode: 35 })
    await wait(`${field('arbitrator')}.value===${JSON.stringify(entered)}`)
    assert(await evaluate(`document.documentElement.scrollWidth<=innerWidth`), 'known-address controls fit narrow layouts')
    const doc = await call('DOM.getDocument', {})
    const node = await call('DOM.querySelector', { nodeId: doc.root.nodeId, selector: 'select[aria-label="Use a known address for arbitrator"]' })
    const ax = await call('Accessibility.getPartialAXTree', { nodeId: node.nodeId, fetchRelatives: false })
    assert(ax.nodes.some(node => !node.ignored && node.role?.value === 'combobox' && node.name?.value === 'Use a known address for arbitrator'))
  }
  await evaluate('connectionFixture.state.holdPublicRead=true')
  const beforeRefresh = await evaluate('connectionFixture.state.subjects.length')
  await evaluate(`[...document.querySelectorAll('.ui-meta>button')].find(button=>button.textContent==='Refresh').click()`)
  await wait(`connectionFixture.state.subjects.length>${beforeRefresh}&&${field('contractor')}.disabled`)
  assert(await evaluate(`${select}.disabled`), 'busy views block both typing and explicit address insertion')
  await evaluate('connectionFixture.releasePublicReads()')
  await wait(`!${field('contractor')}.disabled`)
  assert((await evaluate(options)).some(option => option.value === entered), 'refresh retains entered suggestions')
  assert.equal(await evaluate('connectionFixture.state.sends'), 0)
  return { knownAddresses: true, explicitInsertion: true, nativeKeyboard: true, currentViewRoles: true, paymentWrites: 0 }
}
