import assert from 'node:assert/strict'
import { assertHiddenEditorLayoutWitnesses, assertNoHiddenEditorLayout } from './layout-stability.mjs'
import { finishDisplayFixture, navigateBrowserDocument, waitForBrowserCondition } from './escrow-browser-fixture.mjs'
import { assertBuildFooter, assertDisplayedValues, assertDisplayFailureWitnesses, assertNativeIdentifierCopy, assertManualCopyRecovery, assertNumericValidationPresentation } from './display-contracts.mjs'

async function assertActionOrder({ call, evaluate, selector, labels }) {
  for (const width of [1280, 761, 320]) {
    await call('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false })
    const result = await evaluate(`(() => {
      const buttons = [...document.querySelectorAll(${JSON.stringify(selector)} + ' > button')];
      if (buttons.length !== 2) return null;
      const [first, second] = buttons.map(button => button.getBoundingClientRect());
      return { labels: buttons.map(button => button.textContent.trim()),
        ordered: second.top > first.top + 1 || (Math.abs(second.top - first.top) <= 1 && second.left > first.left),
        fits: document.documentElement.scrollWidth <= innerWidth };
    })()`)
    assert.deepEqual(result, { labels, ordered: true, fits: true }, `${selector}: primary action precedes the secondary action at ${width}px`)
  }
  await evaluate(`document.querySelector(${JSON.stringify(selector)} + ' > button').focus()`)
  await call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 })
  await call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 })
  assert(await evaluate(`document.activeElement === document.querySelectorAll(${JSON.stringify(selector)} + ' > button')[1]`), `${selector}: Tab moves from primary to secondary action`)
  await call('Emulation.clearDeviceMetricsOverride')
  await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
}

async function pointer({ call, type, x, y, buttons }) {
  await call('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons, clickCount: 1 })
}

export async function checkActionStyles({ call, evaluate, viewerURL }) {
  const fixture = new URL('/test/action-style-fixture.html', viewerURL)
  fixture.search = new URL(viewerURL).search
  const wait = expression => waitForBrowserCondition(() => evaluate(expression), `action fixture: ${expression}`)
  const failures = []
  try {
    await navigateBrowserDocument({ call, url: fixture.href, description: 'the action fixture',
      ready: () => evaluate(`!!window.actionFixture&&document.querySelectorAll('.elements .action-button').length===6`) })
    const enterText = async (name, value) => {
      await evaluate(`(()=>{const input=document.querySelector('input[name=${JSON.stringify(name)}]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(value)});input.dispatchEvent(new Event('input',{bubbles:true}))})()`)
      await wait(`document.querySelector('input[name=${JSON.stringify(name)}]').value===${JSON.stringify(value)}`)
    }
    assert(await evaluate(`document.querySelector('input[name="bytes32Draft"]').getAttribute('aria-invalid')==='false'`), 'untouched empty hex field is neutral')
    await enterText('bytes32Draft', 'asdfasd')
    assert(await evaluate(`(()=>{const input=document.querySelector('input[name="bytes32Draft"]'),hint=document.getElementById(input.getAttribute('aria-describedby'));return input.getAttribute('aria-invalid')==='true'&&getComputedStyle(input).borderColor==='rgb(154, 52, 46)'&&hint.textContent.includes('64 hexadecimal')&&getComputedStyle(hint).position==='absolute'})()`), 'malformed bytes32 has visible and accessible feedback without commentary')
    await enterText('bytes32Draft', '0x' + 'aB'.repeat(32))
    assert(await evaluate(`document.querySelector('input[name="bytes32Draft"]').getAttribute('aria-invalid')==='false'`), 'a valid mixed-case 32-byte value is accepted without rewriting')
    await wait(`!!document.querySelector('input[name="bytes32Draft"]').closest('.compact-hex-entry').querySelector('.compact-hex-display')`)
    assert(await evaluate(`(()=>{const input=document.querySelector('input[name="bytes32Draft"]'),display=input.closest('.compact-hex-entry').querySelector('.compact-hex-display');return input.value===${JSON.stringify('0x' + 'aB'.repeat(32))}&&display.getAttribute('aria-hidden')==='true'&&display.querySelector('code').textContent===input.value})()`), 'unfocused valid hex is compact while retaining the exact accessible input value')
    await evaluate(`document.querySelector('input[name="bytes32Draft"]').focus()`)
    await wait(`!document.querySelector('input[name="bytes32Draft"]').closest('.compact-hex-entry').querySelector('.compact-hex-display')`)
    assert(await evaluate(`document.querySelector('input[name="bytes32Draft"]').value===${JSON.stringify('0x' + 'aB'.repeat(32))}`), 'focus reveals the full unchanged value for editing')
    await evaluate(`document.querySelector('input[name="bytes32Draft"]').blur()`)
    await wait(`!!document.querySelector('input[name="bytes32Draft"]').closest('.compact-hex-entry').querySelector('.compact-hex-display')`)
    for (const width of [1280, 320]) {
      await call('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false })
      assert(await evaluate(`(()=>{const input=document.querySelector('input[name="bytes32Draft"]'),entry=input.closest('.compact-hex-entry'),display=entry.querySelector('.compact-hex-display');return display.getBoundingClientRect().width<=innerWidth&&display.querySelector('.hex-ellipsis')!==null&&input.value===${JSON.stringify('0x' + 'aB'.repeat(32))}&&document.documentElement.scrollWidth<=innerWidth})()`), `compact hex fits at ${width}px`)
    }
    await call('Emulation.clearDeviceMetricsOverride')
    const doc = await call('DOM.getDocument', {})
    const inputNode = await call('DOM.querySelector', { nodeId: doc.root.nodeId, selector: 'input[name=bytes32Draft]' })
    const ax = await call('Accessibility.getPartialAXTree', { nodeId: inputNode.nodeId, fetchRelatives: false })
    assert(ax.nodes.some(node => !node.ignored && node.role?.value === 'textbox' && node.name?.value === 'Agreement ID' && node.value?.value === '0x' + 'aB'.repeat(32)), 'one labeled input exposes the full hex value to accessibility')
    await enterText('document', '0x' + 'cd'.repeat(32))
    assert(await evaluate(`!!document.querySelector('input[name="document"]').closest('.compact-hex-entry').querySelector('.compact-hex-display')`), 'a valid document digest uses the shared compact presentation')
    await evaluate(`document.querySelector('input[name="document"]').focus()`)
    await wait(`!document.querySelector('input[name="document"]').closest('.compact-hex-entry').querySelector('.compact-hex-display')`)
    assert(await evaluate(`document.querySelector('input[name="document"]').value===${JSON.stringify('0x' + 'cd'.repeat(32))}`), 'focusing a document digest preserves its full value')
    await enterText('document', '')
    await evaluate(`document.querySelector('input[name="document"]').blur()`)
    await enterText('signatureDraft', '0x' + 'ab'.repeat(64))
    assert(await evaluate(`document.querySelector('input[name="signatureDraft"]').getAttribute('aria-invalid')==='true'`), 'a 64-byte signature is rejected')
    await enterText('signatureDraft', '0x' + 'ab'.repeat(65))
    assert(await evaluate(`document.querySelector('input[name="signatureDraft"]').getAttribute('aria-invalid')==='false'`), 'a 65-byte signature has a valid shape')
    assert(await evaluate(`!!document.querySelector('input[name="signatureDraft"]').closest('.compact-hex-entry').querySelector('.compact-hex-display')`), 'longer valid hex values use the same compact presentation')
    await enterText('bytes32Draft', '0xabc')
    assert(await evaluate(`!document.querySelector('input[name="bytes32Draft"]').closest('.compact-hex-entry').querySelector('.compact-hex-display')`), 'incomplete drafts remain visible without shortening')
    await enterText('boundedDraft', 'éé')
    assert(await evaluate(`document.querySelector('input[name="boundedDraft"]').getAttribute('aria-invalid')==='false'`), 'four UTF-8 bytes fit the bound')
    await enterText('boundedDraft', 'ééé')
    assert(await evaluate(`document.querySelector('input[name="boundedDraft"]').getAttribute('aria-invalid')==='true'`), 'UTF-8 byte limits do not count characters')
    await enterText('boundedDraft', ' ')
    assert(await evaluate(`document.querySelector('input[name="boundedDraft"]').getAttribute('aria-invalid')==='false'`), 'nonempty text is not trimmed')
    await enterText('boundedDraft', '')
    await evaluate(`(()=>{const input=document.querySelector('input[name="boundedDraft"]');input.focus();input.blur()})()`)
    await wait(`document.querySelector('input[name="boundedDraft"]').getAttribute('aria-invalid')==='true'`)
    const uri = `document.querySelector('input[name="documentURI"]')`
    for (const width of [1280, 320]) {
      await call('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false })
      const control = await evaluate(`(() => {
        const group = document.querySelector('.uri-control');
        const input = group.querySelector('input').getBoundingClientRect();
        const button = group.querySelector('button').getBoundingClientRect();
        const bounds = group.getBoundingClientRect();
        return { label: group.querySelector('button').getAttribute('aria-label'), title: group.querySelector('button').title, icon: !!group.querySelector('button svg[aria-hidden="true"]'),
          joined: Math.abs(input.right - button.left) < 1, aligned: Math.abs(input.top - button.top) < 1 && Math.abs(input.bottom - button.bottom) < 1,
          contained: bounds.width <= innerWidth && button.right <= innerWidth && input.width > 0 };
      })()`)
      assert.deepEqual(control, { label: 'Embed document for Terms URI', title: 'Embed document for Terms URI', icon: true, joined: true, aligned: true, contained: true }, `URI input and action share one usable control at ${width}px`)
    }
    await call('Emulation.clearDeviceMetricsOverride')
    await evaluate(`(()=>{const button=document.querySelector('.uri-control > button');button.focus();button.click()})()`)
    await wait(`document.querySelector('.uri-field dialog')?.open`)
    await assertActionOrder({ call, evaluate, selector: '.uri-dialog-actions', labels: ['Use document', 'Cancel'] })
    const nativeLightDismiss = await evaluate(`'closedBy' in HTMLDialogElement.prototype`)
    for (const fallback of nativeLightDismiss ? [false, true] : [true]) {
      if (fallback && nativeLightDismiss) await evaluate(`(()=>{window.dialogClosedByDescriptor=Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype,'closedBy');delete HTMLDialogElement.prototype.closedBy;document.querySelector('.uri-field dialog').setAttribute('closedby','closerequest')})()`)
      try {
        await evaluate(`(()=>{const input=document.querySelector('.uri-field dialog textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,'Unapplied draft');input.dispatchEvent(new Event('input',{bubbles:true}))})()`)
        const inside = await evaluate(`(()=>{const r=document.querySelector('.uri-field dialog').getBoundingClientRect();return {x:r.left+8,y:r.top+8}})()`)
        await pointer({ call, type: 'mousePressed', ...inside, buttons: 1 })
        await pointer({ call, type: 'mouseReleased', ...inside, buttons: 0 })
        assert(await evaluate(`document.querySelector('.uri-field dialog').open`), 'clicking dialog padding does not dismiss it')
        await pointer({ call, type: 'mousePressed', ...inside, buttons: 1 })
        await pointer({ call, type: 'mouseMoved', x: 2, y: 2, buttons: 1 })
        await pointer({ call, type: 'mouseReleased', x: 2, y: 2, buttons: 0 })
        assert(await evaluate(`document.querySelector('.uri-field dialog').open`), 'a drag starting inside does not dismiss the dialog')
        await pointer({ call, type: 'mousePressed', x: 2, y: 2, buttons: 1 })
        await pointer({ call, type: 'mouseMoved', ...inside, buttons: 1 })
        await pointer({ call, type: 'mouseReleased', ...inside, buttons: 0 })
        assert(await evaluate(`document.querySelector('.uri-field dialog').open`), 'a drag ending inside does not dismiss the dialog')
        await pointer({ call, type: 'mousePressed', x: 2, y: 2, buttons: 1 })
        await pointer({ call, type: 'mouseReleased', x: 2, y: 2, buttons: 0 })
        await wait(`!document.querySelector('.uri-field dialog').open`)
        assert.equal(await evaluate(`${uri}.value`), 'https://example.test/terms', 'outside dismissal does not apply the draft')
        assert(await evaluate(`document.activeElement===document.querySelector('.uri-control > button')`), 'outside dismissal restores focus to the opener')
      } finally {
        if (fallback && nativeLightDismiss) await evaluate(`Object.defineProperty(HTMLDialogElement.prototype,'closedBy',window.dialogClosedByDescriptor);delete window.dialogClosedByDescriptor;document.querySelector('.uri-field dialog').setAttribute('closedby','any')`)
      }
      await evaluate(`(()=>{const button=document.querySelector('.uri-control > button');button.focus();button.click()})()`)
      await wait(`document.querySelector('.uri-field dialog')?.open`)
    }
    await call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
    await call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
    await wait(`!document.querySelector('.uri-field dialog').open`)
    assert.equal(await evaluate(`${uri}.value`), 'https://example.test/terms', 'Escape leaves the URI unchanged')
    await evaluate(`document.querySelector('.uri-control > button').click()`)
    await wait(`document.querySelector('.uri-field dialog')?.open`)
    assert(await evaluate(`(()=>{const counter=document.querySelector('.uri-capacity'),input=document.querySelector('.uri-document-control textarea'),a=input.getBoundingClientRect(),b=counter.getBoundingClientRect();return counter.getAttribute('aria-label').includes('of 512 bytes') && input.getAttribute('aria-describedby')===counter.id && b.right<=a.right && b.bottom<=a.bottom && b.top>=a.bottom-parseFloat(getComputedStyle(input).paddingBottom)})()`), 'the accessible capacity counter fits inside the reserved lower-right area')
    const axDocument = await call('DOM.getDocument', {})
    const axInput = await call('DOM.querySelector', { nodeId: axDocument.root.nodeId, selector: '.uri-document-control textarea' })
    const axTree = await call('Accessibility.getPartialAXTree', { nodeId: axInput.nodeId, fetchRelatives: false })
    assert.equal(axTree.nodes[0].name.value, 'Document', 'the textarea retains its accessible name without a visible label')
    assert(axTree.nodes[0].description?.value.includes('of 512 bytes'), 'the textbox exposes the encoded byte count and limit as its accessible description')
    const axSelect = await call('DOM.querySelector', { nodeId: axDocument.root.nodeId, selector: '.uri-field dialog select' })
    const axSelectTree = await call('Accessibility.getPartialAXTree', { nodeId: axSelect.nodeId, fetchRelatives: false })
    assert.equal(axSelectTree.nodes[0].name.value, 'Content type', 'the content selector retains its accessible name')
    assert(await evaluate(`(()=>{const dialog=document.querySelector('.uri-field dialog');return [...dialog.querySelectorAll('label.visually-hidden, label .visually-hidden')].length===2 && [...dialog.querySelectorAll('label.visually-hidden, label .visually-hidden')].every(label=>getComputedStyle(label).position==='absolute'&&label.getBoundingClientRect().width<=1)})()`), 'the redundant labels do not take up visible space')
    await evaluate(`(()=>{const select=document.querySelector('.uri-field dialog select');select.value='application/json';select.dispatchEvent(new Event('change',{bubbles:true}))})()`)
    await wait(`document.querySelector('.uri-field dialog select').value==='application/json'`)
    await evaluate(`(()=>{const input=document.querySelector('.uri-field dialog textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,'{');input.dispatchEvent(new Event('input',{bubbles:true}))})()`)
    await evaluate(`[...document.querySelectorAll('.uri-field dialog button')].find(button=>button.textContent==='Use document').click()`)
    await wait(`!!document.querySelector('.uri-field dialog [role="alert"]')`)
    assert(await evaluate(`document.querySelector('.uri-capacity').getAttribute('aria-label').includes('size unavailable')`), 'invalid JSON does not claim a size for an unavailable URI')
    assert.equal(await evaluate(`${uri}.value`), 'https://example.test/terms', 'invalid JSON does not change the URI')
    const documentText = '{ "serial": 9007199254740993, "title": "🚲" }'
    await evaluate(`(()=>{const input=document.querySelector('.uri-field dialog textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,${JSON.stringify(documentText)});input.dispatchEvent(new Event('input',{bubbles:true}))})()`)
    const displayedBytes = await evaluate(`Number(document.querySelector('.uri-capacity').textContent.split('/')[0].trim())`)
    await evaluate(`[...document.querySelectorAll('.uri-field dialog button')].find(button=>button.textContent==='Use document').click()`)
    await wait(`!document.querySelector('.uri-field dialog').open`)
    assert.equal(await evaluate(`fetch(${uri}.value).then(response=>response.text())`), documentText, 'embedded JSON preserves the entered text')
    const embeddedURI = await evaluate(`${uri}.value`)
    assert.equal(displayedBytes, new TextEncoder().encode(embeddedURI).byteLength, 'counter measures encoded URI bytes rather than document characters')
    assert.equal(await evaluate(`document.querySelector('.uri-control > button').getAttribute('aria-label')`), 'Edit embedded document for Terms URI')
    assert.equal(await evaluate(`document.querySelector('.uri-control > button').title`), 'Edit embedded document for Terms URI')
    await evaluate(`[...document.querySelectorAll('.uri-value button')].find(button=>button.textContent==='View').click()`)
    await wait(`!!document.querySelector('.uri-value .json-view pre')`)
    assert.equal(await evaluate(`document.querySelector('.uri-value .json-view pre').textContent`), documentText, 'read-only URI inspection shows the decoded document')
    await evaluate(`Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async value=>{window.copiedURI=value}}});document.querySelector('.uri-value button[aria-label="Copy Recorded URI"]').click()`)
    await wait(`window.copiedURI!==undefined`)
    assert.equal(await evaluate(`window.copiedURI`), embeddedURI, 'the shared copy icon copies the exact URI')
    await evaluate(`navigator.clipboard.writeText=async()=>{throw new Error('clipboard denied')};document.querySelector('.uri-value button[aria-label="Copy Recorded URI"]').click()`)
    await wait(`!!document.querySelector('.uri-value .copy-recovery input')`)
    assert.equal(await evaluate(`document.querySelector('.uri-value .copy-recovery input').value`), embeddedURI, 'clipboard failure retains a manually selectable exact URI')
    await evaluate(`navigator.clipboard.writeText=async value=>{window.copiedURI=value};document.querySelector('.uri-value button[aria-label="Copy Recorded URI"]').click()`)
    await wait(`!document.querySelector('.uri-value .copy-recovery')`)
    await evaluate(`document.querySelector('.uri-control > button').click()`)
    await wait(`document.querySelector('.uri-field dialog')?.open`)
    await evaluate(`[...document.querySelectorAll('.uri-field dialog button')].find(button=>button.textContent==='Cancel').click()`)
    await wait(`!document.querySelector('.uri-field dialog').open`)
    assert.equal(await evaluate(`${uri}.value`), embeddedURI, 'cancelling preserves the exact URI')
    await evaluate(`document.querySelector('.uri-control > button').click()`)
    await wait(`document.querySelector('.uri-field dialog')?.open`)
    await evaluate(`(()=>{const select=document.querySelector('.uri-field dialog select');select.value='text/plain';select.dispatchEvent(new Event('change',{bubbles:true}))})()`)
    await wait(`document.querySelector('.uri-field dialog select').value==='text/plain'`)
    await evaluate(`(()=>{const input=document.querySelector('.uri-field dialog textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,'x'.repeat(520));input.dispatchEvent(new Event('input',{bubbles:true}))})()`)
    assert(await evaluate(`document.querySelector('.uri-capacity').dataset.overLimit==='true' && document.querySelector('.uri-capacity').textContent.includes('!') && document.querySelector('.uri-capacity').getAttribute('aria-label').includes('over limit')`), 'over-limit capacity is exposed without relying on color')
    await evaluate(`[...document.querySelectorAll('.uri-field dialog button')].find(button=>button.textContent==='Use document').click()`)
    await wait(`document.querySelector('.uri-field dialog [role="alert"]')?.textContent.includes('512-byte limit')`)
    assert.equal(await evaluate(`${uri}.value`), embeddedURI, 'an oversized embedded URI does not change the bound value')
    await evaluate(`[...document.querySelectorAll('.uri-field dialog button')].find(button=>button.textContent==='Cancel').click()`)
    await wait(`!document.querySelector('.uri-field dialog').open`)
    await evaluate(`document.querySelector('.uri-control > button').click()`)
    await wait(`document.querySelector('.uri-field dialog')?.open`)
    await evaluate(`window.actionFixture.uri('https://example.test/newer')`)
    await wait(`${uri}.value==='https://example.test/newer'`)
    await evaluate(`[...document.querySelectorAll('.uri-field dialog button')].find(button=>button.textContent==='Use document').click()`)
    await wait(`document.querySelector('.uri-field dialog [role="alert"]')?.textContent.includes('view or URI changed')`)
    assert.equal(await evaluate(`${uri}.value`), 'https://example.test/newer', 'a stale embedded draft cannot replace a newer URI')
    assert(await evaluate(`document.querySelector('.uri-field dialog textarea').value.length>0`), 'a stale draft remains available to copy')
    await evaluate(`[...document.querySelectorAll('.uri-field dialog button')].find(button=>button.textContent==='Cancel').click()`)
    await wait(`!document.querySelector('.uri-field dialog').open`)
    await evaluate(`document.querySelector('.nft-row .resource-load').click()`)
    await wait(`document.querySelector('.nft-row img')?.naturalWidth===2`)
    const displayedChain = `[...document.querySelectorAll('.connection-facts dt')].find(term=>term.textContent==='Chain').nextElementSibling.textContent`
    await wait(`${displayedChain}==='Anvil (eip155:31337)'`)
    await evaluate(`window.actionFixture.connectionChain('eip155:43113')`)
    await wait(`${displayedChain}==='Fuji (eip155:43113)'`)
    await evaluate(`window.actionFixture.connectionChain('eip155:2147483646')`)
    await wait(`${displayedChain}==='eip155:2147483646'`)
    await evaluate(`window.actionFixture.connectionChain('eip155:31337')`)
    await wait(`${displayedChain}==='Anvil (eip155:31337)'`)
    const preamble = await evaluate(`(() => {
      const connection=document.querySelector('section[aria-label="App and connection"]')
      const labels=[...connection.querySelectorAll('dt')]
      const value=label=>labels.find(term=>term.textContent===label)?.nextElementSibling
      return {expanded:!connection.querySelector('details'),
        account:value('Viewing as')?.querySelector('code')?.textContent,
        wallet:value('Signing wallet')?.querySelector('code')?.textContent,
        chain:value('Chain')?.textContent,
        host:value('CAM contract')?.querySelector('code')?.textContent,
        route:value('Read route')?.textContent,
        uiURI:value('UI resource')?.textContent,
        visible:['Viewing as','Signing wallet','Chain','CAM contract','Read route','UI resource'].every(label=>value(label)?.getClientRects().length>0),
        walletStatus:!!value('Signing wallet').querySelector('[role="status"]'),
        walletEnabled:!connection.querySelector('.wallet-button').disabled}
    })()`)
    assert.deepEqual(preamble, { expanded: true, account: '0x1111111111111111111111111111111111111111', wallet: '0x2222222222222222222222222222222222222222', chain: 'Anvil (eip155:31337)', host: '0x3333333333333333333333333333333333333333', route: 'fixture', uiURI: 'fixture', visible: true, walletStatus: true, walletEnabled: true }, 'connection and app facts are visible without expansion, with the wallet action available')
    const longResource = `https://example.test/${'x'.repeat(500)}`
    await evaluate(`window.actionFixture.appDetails('next',${JSON.stringify(longResource)})`)
    await wait(`[...document.querySelectorAll('.connection-facts .key-value')].some(row=>row.querySelector('dt')?.textContent==='UI resource'&&row.querySelector('dd')?.textContent===${JSON.stringify(longResource)})`)
    const viewport = await evaluate('({width:innerWidth,height:innerHeight})')
    for (const width of [1280, 761, 320]) {
      await call('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false })
      assert(await evaluate(`document.documentElement.scrollWidth<=innerWidth&&[...document.querySelectorAll('.connection-facts .key-value')].some(row=>row.querySelector('dt')?.textContent==='Read route'&&row.querySelector('dd')?.textContent==='next')`), `changed app details remain visible without overflowing at ${width}px`)
    }
    await call('Emulation.setDeviceMetricsOverride', { ...viewport, deviceScaleFactor: 1, mobile: false })
    await wait(`innerWidth===${viewport.width}&&innerHeight===${viewport.height}`)
    await evaluate('window.actionFixture.appDetails(undefined,undefined)')
    await wait(`![...document.querySelectorAll('.connection-facts dt')].some(term=>['Read route','UI resource'].includes(term.textContent))`)
    await evaluate(`window.actionFixture.appDetails('fixture','fixture')`)
    await wait(`[...document.querySelectorAll('.connection-facts dt')].some(term=>term.textContent==='Read route')`)
    await evaluate(`Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async value=>{window.copiedIdentifier=value}}})`)
    await assertDisplayedValues({ call, evaluate })
    await assertDisplayFailureWitnesses({ call, evaluate })
    await assertNumericValidationPresentation({ evaluate, wait })
    await evaluate(`(()=>{
      const input=document.querySelector('input[inputmode]');
      const group=input.closest('fieldset');
      const editor=group===null?input.closest('label.field').parentElement:group;
      window.numericSummaryWitness=()=>{const output=document.createElement('output');output.dataset.numericSummaryWitness='true';output.textContent='Derived input result';editor.append(output)};
      input.addEventListener('input',window.numericSummaryWitness,{once:true});
    })()`)
    try {
      await assert.rejects(assertNumericValidationPresentation({ evaluate, wait }), /numeric editor visible content and size/, 'numeric editing rejects an appearing result regardless of its markup')
    } finally {
      await evaluate(`(()=>{
        document.querySelector('input[inputmode]').removeEventListener('input',window.numericSummaryWitness);
        document.querySelector('[data-numeric-summary-witness]')?.remove();
        delete window.numericSummaryWitness;
      })()`)
    }
    await evaluate(`navigator.clipboard.writeText=()=>new Promise(resolve=>{window.finishOldCopy=resolve});document.querySelector('.hex-value .copy-button').click();window.actionFixture.account('0x4444444444444444444444444444444444444444')`)
    await wait(`document.querySelector('.hex-value code').textContent==='0x4444444444444444444444444444444444444444'`)
    await evaluate('window.finishOldCopy()')
    assert(await evaluate(`!document.querySelector('.hex-value [role="status"]').textContent`), 'a late copy completion does not acknowledge a different displayed address')
    await assertManualCopyRecovery({ call, evaluate, wait })
    await evaluate('new Promise(resolve=>setTimeout(resolve,2100))')
    assert(await evaluate(`!!document.querySelector('.copy-recovery')`), 'clipboard failure does not expire with success feedback')
    await evaluate(`window.actionFixture.account('0x1111111111111111111111111111111111111111')`)
    await evaluate(`navigator.clipboard.writeText=async value=>{window.copiedIdentifier=value}`)
    await evaluate(`document.querySelector('.wallet-button').click()`)
    assert(await evaluate(`window.actionFixture.events.wallet===1&&window.actionFixture.events.send===0`), 'wallet connection remains usable without sending a transaction')
    assert(await evaluate(`(() => { const group=document.querySelector('section[aria-label="Fixture actions"]');return group?.querySelector('h2')?.textContent==='Fixture actions'&&!!group.querySelector('input[name="draft"]')&&group.querySelectorAll('.action-button').length===6 })()`), 'a declared group keeps its heading, inputs and commands together')
    assert(await evaluate(`
      [...document.querySelectorAll('button')].every(button =>
        button.type === 'button' && !button.hasAttribute('href'))
    `), 'commands and tab controls retain native button elements')

    await evaluate(`document.querySelectorAll('.action-button')[0].click()`)
    await wait(`window.actionFixture.events.navigate===1`)
    assert(await evaluate(`!document.querySelector('.prepared-call')&&window.actionFixture.events.send===0`), 'read actions never prepare or send')
    await evaluate(`document.querySelectorAll('.action-button')[1].click()`)
    await wait(`!!document.querySelector('.prepared-call')`)
    assert(await evaluate(`window.actionFixture.events.contractCall===1&&window.actionFixture.events.send===0`), 'write actions only prepare review')
    await evaluate(`navigator.clipboard.writeText=async value=>{window.copiedIdentifier=value}`)
    for (const selector of ['.hex-value', '.json-view']) {
      const control = `document.querySelector('${selector} .copy-button')`
      const status = `document.querySelector('${selector} [role="status"]')`
      await evaluate(`${control}.click()`)
      await wait(`${status}.textContent.includes('copied')`)
      await evaluate('new Promise(resolve=>setTimeout(resolve,1200))')
      await evaluate(`${control}.click()`)
      await evaluate('new Promise(resolve=>setTimeout(resolve,1000))')
      assert(await evaluate(`${status}.textContent.includes('copied')`), 'repeated copying restarts success feedback instead of expiring on the old timer')
      await wait(`${status}.textContent===''`)
      assert(await evaluate(`${control}.querySelector('rect')!==null`), 'success feedback returns to the copy icon')
    }
    assert(await evaluate(`(()=>{const raw=[...document.querySelectorAll('.prepared-call .key-value')].filter(row=>row.firstElementChild.textContent.endsWith('(bytes)'));return raw.length>0&&raw.every(row=>row.lastElementChild.textContent==='0x'+'ab'.repeat(32)&&!row.querySelector('.hex-value'))})()`), 'dynamic calldata stays exact and unshortened')

    const styles = await evaluate(`(() => {
      const signature = element => {
        const style = getComputedStyle(element)
        return JSON.stringify([style.color, style.backgroundColor, style.borderColor,
          style.borderStyle, style.borderWidth, style.borderRadius, style.padding, style.minHeight])
      }
      const [read,write] = document.querySelectorAll('.action-button')
      const reference = signature(write)
      const quiet = [...document.querySelectorAll('.ui-meta>button, .transaction-actions>button:not(.send-button)')]
      quiet.push(...document.querySelectorAll('.document-hash-field button'))
      const send = getComputedStyle(document.querySelector('.send-button'))
      const command = getComputedStyle(write)
      return {
        commandsOutlined: command.backgroundColor !== command.borderColor && command.borderStyle === 'solid',
        readDistinct: signature(read) !== signature(write) && getComputedStyle(read).backgroundColor === 'rgba(0, 0, 0, 0)',
        kindsVisible: read.textContent.includes('→') && !read.querySelector('.action-effect') && write.textContent.includes('Review transaction') && read.getAttribute('aria-description')==='Read only' && write.getAttribute('aria-description')==='Review transaction',
        quietDistinct: signature(quiet[0]) !== reference,
        quietUnfilled: quiet.every(button => getComputedStyle(button).backgroundColor === 'rgba(0, 0, 0, 0)' && getComputedStyle(button).borderColor === 'rgba(0, 0, 0, 0)'),
        sendFilled: send.backgroundColor === send.borderColor && send.backgroundColor !== command.backgroundColor,
      }
    })()`)
    assert(styles.readDistinct && styles.commandsOutlined && styles.kindsVisible, 'read-only actions and transaction reviews have distinct visible and accessible treatments even when labels suggest the opposite')
    assert(styles.quietDistinct && styles.quietUnfilled, 'navigation, discard and document calculation helpers have a quiet supporting treatment')
    assert(styles.sendFilled, 'only Send is filled')
    await assertActionOrder({ call, evaluate, selector: '.transaction-actions', labels: ['Send with wallet', 'Discard transaction'] })
    for (const width of [1280, 761, 320]) {
      await call('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false })
      assert(await evaluate(`(()=>{
        const row=document.querySelector('.transaction-actions');
        const [send,discard]=row.querySelectorAll('button');
        const a=send.getBoundingClientRect(),b=discard.getBoundingClientRect();
        const textTop=button=>{const range=document.createRange();range.selectNodeContents(button);return range.getBoundingClientRect().top};
        return send.classList.contains('send-button')&&discard.textContent.trim()==='Discard transaction'
          &&Math.abs(a.height-b.height)<1&&document.documentElement.scrollWidth<=innerWidth
          &&(innerWidth>=761?Math.abs(a.top-b.top)<1&&Math.abs(textTop(send)-textTop(discard))<1:b.top>=a.top&&b.left>=row.getBoundingClientRect().left);
      })()`), `transaction actions align together and wrap within ${width}px`)
    }
    assert(await evaluate(`document.querySelector('.prepared-call .json-view pre').textContent===actionFixture.reviewJson&&document.querySelector('.prepared-call textarea[readonly]').value===actionFixture.reviewURI`), 'review decodes embedded JSON exactly while retaining the full URI')
    assert(await evaluate(`(()=>{const bytes=document.querySelector('textarea[aria-label="Transaction data (hex)"]');return bytes.readOnly&&!bytes.disabled&&bytes.value.length>2000&&bytes.value===actionFixture.reviewCalldata})()`), 'full calldata remains selectable without truncation or hash shortening')
    for (const [stage,label] of [['checking','Checking transaction…'],['wallet','Waiting for wallet…'],['confirming','Waiting for confirmation…'],['refreshing','Loading updated view…']]) {
      await evaluate(`actionFixture.stage(${JSON.stringify(stage)})`)
      await wait(`document.querySelector('.send-button').textContent.trim()===${JSON.stringify(label)}`)
      assert(await evaluate(`document.querySelector('.send-button').disabled&&[...document.querySelectorAll('.prepared-call button')].find(button=>button.textContent.trim()==='Discard transaction').disabled`), 'pending submission cannot be sent twice or discarded')
      assert(await evaluate(`!document.querySelector('textarea[aria-label="Transaction data (hex)"]').disabled`), 'calldata inspection remains available while the wallet request is pending')
      if (stage==='wallet') assert(await evaluate(`document.querySelector('.prepared-call [role="status"][data-kind="status"]').textContent.includes('open your wallet')`), 'a hidden wallet popup has an explicit next action')
    }
    await evaluate('actionFixture.sending(false)')

    assert(await evaluate(`(() => {
      const controls = [...document.querySelectorAll('.ui-meta>button')]
      const tops = controls.map(control => {
        const range = document.createRange()
        range.selectNodeContents(control)
        return range.getBoundingClientRect().top
      })
      return Math.max(...tops) - Math.min(...tops) <= 1
    })()`), 'toolbar actions share a text baseline')

    assert(await evaluate(`(() => {
      const [read,write,unknown,disabledRead,disabledWrite] = document.querySelectorAll('.action-button')
      disabledRead.click(); disabledWrite.click(); read.focus()
      return document.activeElement === read && disabledRead.disabled && disabledWrite.disabled
        && window.actionFixture.events.navigate === 1 && window.actionFixture.events.contractCall === 1
    })()`), 'disabled actions stay visible and inert; enabled buttons remain focusable')
    await evaluate(`document.querySelectorAll('.action-button')[2].click()`)
    assert(await evaluate(`window.actionFixture.events.unsupported===1&&window.actionFixture.events.send===0`), 'unsupported actions retain their click path')
    const beforeTimestamp = await evaluate(`JSON.stringify(window.actionFixture.events)`)
    await evaluate(`document.querySelector('.timestamp-options').click()`)
    await wait(`document.querySelector('.timestamp-options').getAttribute('aria-pressed')==='true'`)
    assert(await evaluate(`window.actionFixture.events.send === 0 && window.actionFixture.events.contractCall === 1`), 'changing time presentation does not prepare or send a transaction')

    assert.equal(await evaluate(`JSON.stringify(window.actionFixture.events)`), beforeTimestamp, 'changing time presentation does not invoke a command')

    for (const state of ['busy', 'sending']) {
      await evaluate(`window.actionFixture.${state}(true)`)
      await wait(`[...document.querySelectorAll('.elements input,.elements textarea,.elements select')].every(control=>control.matches(':disabled'))`)
      assert(await evaluate(`(() => {
        const before = JSON.stringify(window.actionFixture.events)
        for (const button of document.querySelectorAll('.elements .action-button, .elements [role="tab"], .document-hash-field button, .wallet-button, .ui-meta>button')) {
          if (!button.matches(':disabled')) return false
          button.click()
        }
        const commands = [...document.querySelectorAll('.action-button, .wallet-button, .document-hash-field button:not(.button-quiet)')]
        return JSON.stringify(window.actionFixture.events) === before
          && commands.every(button => getComputedStyle(button).cursor === 'not-allowed')
      })()`), `${state} blocks edits and business commands without disabling read-only displays`)
      assert(await evaluate(`(()=>{const facts=Object.fromEntries([...document.querySelectorAll('.elements>.key-value')].map(row=>[row.querySelector('dt').textContent,row.querySelector('dd').textContent]));return facts['Readonly amount']==='0.001 Native asset (1,000,000,000,000,000 wei)'&&facts['Zero amount']==='0 Native asset (0 wei)'})()`), 'read-only amounts expose readable and exact base units at each viewport')
      await assertDisplayedValues({ call, evaluate })
      await evaluate(`window.actionFixture.${state}(false)`)
      await wait(`!document.querySelector('.elements input').matches(':disabled')`)
    }
    for (const width of [1280, 761, 320]) {
      await call('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: true })
      await wait(`innerWidth===${width}`)
      await evaluate(`window.actionFixture.hashPhase('idle')`)
      await wait(`!document.querySelector('.document-hash-field button[aria-busy="true"]')`)
      const hashGeometry = `(()=>{const field=document.querySelector('.document-hash-field'),input=field.querySelector('input[name="document"]'),box=field.getBoundingClientRect(),buttons=[...field.querySelectorAll('button')].filter(button=>button.getClientRects().length),status=field.querySelector('[role=status].resource-status');return {top:box.top,height:box.height,inputTop:input.getBoundingClientRect().top,bottomGap:box.bottom-Math.max(...buttons.map(button=>button.getBoundingClientRect().bottom)),status:status.textContent.trim(),statusHidden:getComputedStyle(status).position==='absolute'&&status.getBoundingClientRect().width<=1,cancel:!!field.querySelector('.resource-cancel').getClientRects().length}})()`
      const idle = await evaluate(hashGeometry)
      assert(idle.bottomGap <= 14 && !idle.cancel && idle.status === '', 'idle digest controls end at their normal padding without reserved feedback or cancellation rows')
      await assertHiddenEditorLayoutWitnesses(evaluate)
      const document = await call('DOM.getDocument', {})
      const textbox = await call('DOM.querySelector', { nodeId: document.root.nodeId, selector: 'input[name="document"]' })
      const accessible = await call('Accessibility.getPartialAXTree', { nodeId: textbox.nodeId, fetchRelatives: false })
      assert(accessible.nodes.some(node => !node.ignored && node.role?.value === 'textbox' && node.name?.value === 'Document'), 'the visible legend names the digest textbox without a repeated caption')
      for (const phase of ['pending', 'succeeded', 'idle']) {
        await evaluate(`window.actionFixture.hashPhase('${phase}')`)
        await wait(`document.querySelector('.document-hash-field button[aria-busy="true"]')!==null === ${phase === 'pending'}`)
        const current = await evaluate(hashGeometry)
        assert.equal(current.top, idle.top, 'feedback does not move the editor start')
        assert.equal(current.inputTop, idle.inputTop, 'feedback does not move the digest input')
        assert.equal(current.cancel, phase === 'pending')
        assert.equal(current.status.length > 0, phase !== 'idle')
        assert(current.statusHidden, 'transient calculation status does not add visible commentary')
        await assertNoHiddenEditorLayout(evaluate)
        if (phase === 'idle') assert.equal(current.height, idle.height, 'the editor returns to its compact idle height')
      }
      const layout = await evaluate(`(() => {
        const rows = [...document.querySelectorAll('.elements>.key-value')]
        const values = rows.map(row => row.lastElementChild.getBoundingClientRect())
        const bounds = document.querySelector('.elements').getBoundingClientRect()
        return {
          overflow: document.documentElement.scrollWidth > innerWidth,
          aligned: Math.abs(values[0].left-values[values.length-1].left) < 1,
          fit: [...document.querySelectorAll('.elements button')].every(button => button.getBoundingClientRect().right <= bounds.right+1),
          draft: window.actionFixture.draft(), sends: window.actionFixture.events.send,
        }
      })()`)
      assert(!layout.overflow && layout.aligned && layout.fit, 'long command labels wrap without overflow or shifting Status values')
      assert.equal(layout.draft, 'unchanged')
      assert.equal(layout.sends, 0)
      await assertDisplayedValues({ call, evaluate })
      await assertBuildFooter({ call, evaluate, wait })
    }
    const transactionHash = `0x${'ab'.repeat(32)}`
    await evaluate(`window.actionFixture.transaction('eip155:43113',${JSON.stringify(transactionHash)})`)
    await wait(`!!document.querySelector('.transaction-feedback a')`)
    assert(await evaluate(`(() => {const link=document.querySelector('.transaction-feedback a');return link.href===${JSON.stringify(`https://testnet.snowtrace.io/tx/${transactionHash}`)}&&link.querySelector('code').textContent===${JSON.stringify(transactionHash)}&&link.target==='_blank'&&link.rel.includes('noopener')&&document.querySelector('.transaction-feedback').textContent.includes('Receipt wait timed out.')})()`), 'uncertain confirmation retains its cause and links the exact submitted hash on its own chain, independently of the viewer chain')
    await assertDisplayedValues({ call, evaluate })
    await evaluate(`navigator.clipboard.writeText=async value=>{window.copiedIdentifier=value};document.querySelector('.transaction-feedback button[aria-label="Copy transaction hash"]').click()`)
    await wait(`window.copiedIdentifier===${JSON.stringify(transactionHash)}`)
    await evaluate(`window.actionFixture.transaction('eip155:1',${JSON.stringify(`0x${'cd'.repeat(32)}`)})`)
    await wait(`document.querySelector('.transaction-feedback a')?.href===${JSON.stringify(`https://etherscan.io/tx/0x${'cd'.repeat(32)}`)}`)
    assert(await evaluate('document.documentElement.scrollWidth<=innerWidth'), 'linked hashes fit the narrow viewport')
    await evaluate(`window.actionFixture.transaction('eip155:2147483646',${JSON.stringify(transactionHash)})`)
    await wait(`!document.querySelector('.transaction-feedback a')&&document.querySelector('.transaction-feedback code')?.title===${JSON.stringify(transactionHash)}`)
    await evaluate(`window.actionFixture.transaction('eip155:43113',undefined)`)
    await wait(`!document.querySelector('.transaction-feedback a, .transaction-feedback .feedback-message code')`)
    assert(await evaluate(`window.actionFixture.events.send===0&&document.querySelector('.transaction-feedback').textContent.includes('Check the transaction before sending another.')`), 'explorer presentation neither submits a transaction nor invents a hash when none was returned')
    const nativeIdentifierCopy = await assertNativeIdentifierCopy({ call, evaluate, origin: fixture.origin })
    return { widths: [1280, 761, 320], actionKindsDistinct: true, supportingQuiet: true, sendFilled: true, editAndCopyCapabilitiesSeparate: true, transactionExplorer: true, nativeIdentifierCopy }
  } catch (error) {
    failures.push(error)
  } finally {
    await finishDisplayFixture({ call, evaluate, viewerURL, failures })
  }
}
