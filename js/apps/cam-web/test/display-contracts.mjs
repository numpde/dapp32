import assert from 'node:assert/strict'
import { assertNoHiddenEditorLayout, assertSingleLineControlSizing } from './layout-stability.mjs'

export async function assertBuildFooter({ call, evaluate, wait }) {
  const footer = `document.querySelector('footer[aria-label="Viewer build"]')`
  await wait(`!!${footer}`)
  const source = '0123456789abcdef0123456789abcdef01234567'
  const shown = await evaluate(`(()=>{const footer=${footer};const time=footer.querySelector('time');const link=footer.querySelector('a');return {outsideMain:footer.closest('main')===null,revision:footer.querySelector('code').title,href:link.href,target:link.target,timestamp:time.dateTime,title:time.title,date:time.textContent,overflow:footer.scrollWidth>footer.clientWidth}})()`)
  assert(shown.outsideMain, 'build information belongs outside the app content')
  assert.equal(shown.revision, source, 'the source revision stays available in full')
  assert.equal(shown.href, `https://github.com/numpde/dapp32/commit/${source}`)
  assert.equal(shown.target, '_blank', 'opening source preserves the current app page')
  assert.equal(shown.timestamp, '2026-01-01T01:02:03Z')
  assert.equal(shown.title, shown.timestamp)
  assert.equal(shown.date, '1 Jan 2026 UTC')
  assert(!shown.overflow, 'the footer fits its viewport')
  await call('Emulation.setTimezoneOverride', { timezoneId: 'Pacific/Honolulu' })
  try {
    await evaluate(`window.actionFixture.build('modified')`)
    await wait(`${footer}.textContent.includes('(modified)')`)
    assert.equal(await evaluate(`${footer}.querySelector('time').textContent`), '1 Jan 2026 UTC', 'the build date stays in UTC across browser timezones')
    for (const [mode, message] of [['development', 'Viewer · Development build'], ['unknown', 'Viewer · Build metadata unavailable']]) {
      await evaluate(`window.actionFixture.build(${JSON.stringify(mode)})`)
      await wait(`${footer}.textContent===${JSON.stringify(message)}`)
      assert(await evaluate(`!${footer}.querySelector('time')&&!${footer}.querySelector('a')`), 'absent build metadata is not replaced by a guessed revision or load time')
    }
  } finally {
    await call('Emulation.setTimezoneOverride', { timezoneId: '' })
    await evaluate(`window.actionFixture.build('known')`)
    await wait(`!!${footer}.querySelector('time')`)
  }
}

export async function assertDisplayedValues({ call, evaluate }) {
  await assertNoHiddenEditorLayout(evaluate)
  await assertSingleLineControlSizing(evaluate)
  await assertFeedbackPresentation(evaluate)
  await assertContentSeparation(evaluate)
  const rows = await evaluate(`(()=>{const rows=[...document.querySelectorAll('dl')];return rows.map(row=>{const outer=row.parentElement.closest('dl');return {tags:[...row.children].map(child=>child.tagName),invalidParent:outer!==null&&row.parentElement.closest('dd')?.parentElement!==outer,label:row.firstElementChild?.textContent,overflow:row.checkVisibility()&&row.scrollWidth>row.clientWidth+1}})})()`)
  assert(rows.length > 0, 'the fixture must exercise property rows')
  for (const row of rows) {
    assert.deepEqual(row.tags, ['DT', 'DD'], 'each property owns one complete label/value group')
    assert(!row.invalidParent && row.label && !row.overflow, `property rows have labels and fit without invalid nesting: ${JSON.stringify(row)}`)
  }
  const identifiers = await evaluate(`[...document.querySelectorAll('.hex-value-controls code')].map((code,index)=>{const range=document.createRange();range.selectNodeContents(code);const middle=code.querySelector('.hex-middle');const ellipsis=code.querySelector('.hex-ellipsis');const bounds=middle?.getBoundingClientRect();return {index,expected:code.title,text:code.textContent,selection:range.toString(),ellipsis:ellipsis===null ? undefined : getComputedStyle(ellipsis,'::after').content,decorative:ellipsis?.getAttribute('aria-hidden')==='true',middleFits:bounds!==undefined&&bounds.width>0&&bounds.width<code.getBoundingClientRect().width,disabled:code.closest('.hex-value').querySelector('button').matches(':disabled')}})`)
  assert(identifiers.length > 0, 'the fixture must exercise identifier displays')
  const document = await call('DOM.getDocument', {})
  const ids = (await call('DOM.querySelectorAll', { nodeId: document.root.nodeId, selector: '.hex-value-controls code' })).nodeIds
  const buttons = (await call('DOM.querySelectorAll', { nodeId: document.root.nodeId, selector: '.hex-value-controls > button' })).nodeIds
  const ax = await call('Accessibility.getFullAXTree', {})
  const byId = new Map(ax.nodes.map(node => [node.nodeId, node]))
  for (const item of identifiers) {
    assert.equal(item.text, item.expected, 'DOM extraction must contain the exact value once')
    assert.equal(item.selection, item.expected, 'selecting the value must contain the exact value once')
    if (/^[0-9a-fA-F]{40}$/.test(item.expected)) {
      assert.equal(await evaluate(`document.querySelectorAll('.hex-value-controls code')[${item.index}].firstElementChild.textContent`), item.expected.slice(0, 8), 'source revisions display their familiar eight-character prefix')
    } else {
      assert(item.decorative && item.ellipsis.includes('...') && item.middleFits, 'middle shortening is visible and decorative')
    }
    assert(!item.disabled, 'read-only copy remains available independently of view edits')
    const { node } = await call('DOM.describeNode', { nodeId: ids[item.index] })
    const root = ax.nodes.find(candidate => candidate.backendDOMNodeId === node.backendNodeId)
    assert(root, 'the identifier has an accessibility subtree')
    const copy = await call('DOM.describeNode', { nodeId: buttons[item.index] })
    const accessibleCopy = ax.nodes.find(candidate => candidate.backendDOMNodeId === copy.node.backendNodeId)
    assert(accessibleCopy && !accessibleCopy.ignored && !accessibleCopy.properties.some(property => property.name === 'disabled' && property.value.value === true), 'read-only copy is enabled in the accessibility tree, including inherited state')
    function text(node) {
      if (node.role?.value === 'StaticText' && !node.ignored) return node.name?.value
      if (node.childIds === undefined) return ''
      return node.childIds.map(id => text(byId.get(id))).join('')
    }
    assert.equal(text(root), item.expected, 'assistive technology receives the exact value without decorative ellipsis')
    assert(await evaluate(`document.querySelectorAll('.hex-value-controls code')[${item.index}].closest('[aria-busy="true"]')===null`), 'copy feedback is not deferred by an unrelated busy ancestor')
    await evaluate(`document.querySelectorAll('.hex-value-controls code')[${item.index}].closest('.hex-value').querySelector('button').click()`)
    assert.equal(await evaluate('window.copiedIdentifier'), item.expected, 'every displayed identifier copies its exact full value')
  }
}

export async function assertNativeIdentifierCopy({ call, evaluate, origin }) {
  // Mouse selection uses desktop hit testing; narrow touch layouts are swept separately.
  await call('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false })
  await call('Browser.setPermission', { permission: { name: 'clipboard-read' }, setting: 'granted', origin })
  await call('Browser.setPermission', { permission: { name: 'clipboard-write' }, setting: 'granted', origin })
  try {
    await evaluate('delete navigator.clipboard')
    const points = await evaluate(`(()=>{const code=document.querySelector('.hex-value-controls code');code.scrollIntoView({block:'center'});const first=code.firstElementChild.getBoundingClientRect(),last=code.lastElementChild.getBoundingClientRect();return {start:{x:first.left,y:first.top+first.height/2},end:{x:last.right,y:last.top+last.height/2},expected:code.title}})()`)
    await call('Input.dispatchMouseEvent', { type: 'mouseMoved', ...points.start })
    await call('Input.dispatchMouseEvent', { type: 'mousePressed', ...points.start, button: 'left', buttons: 1, clickCount: 1 })
    await call('Input.dispatchMouseEvent', { type: 'mouseMoved', ...points.end, button: 'left', buttons: 1 })
    await call('Input.dispatchMouseEvent', { type: 'mouseReleased', ...points.end, button: 'left', buttons: 0, clickCount: 1 })
    assert.equal(await evaluate('getSelection().toString()'), points.expected, 'pointer selection includes the full identifier exactly once')
    await evaluate(`navigator.clipboard.writeText('CAM native clipboard probe')`)
    const available = await evaluate(`navigator.clipboard.readText().then(value=>value==='CAM native clipboard probe')`)
    if (!available) return { nativeClipboardVerified: false, reason: 'Native clipboard failed its direct write/read precondition; exact pointer selection passed.' }
    await call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'c', code: 'KeyC', modifiers: 2, windowsVirtualKeyCode: 67 })
    await call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'c', code: 'KeyC', modifiers: 2, windowsVirtualKeyCode: 67 })
    assert(await evaluate(`navigator.clipboard.readText().then(value=>value===${JSON.stringify(points.expected)})`), 'native selection and Ctrl+C copy the exact full value')
    return { nativeClipboardVerified: true }
  } finally {
    await call('Browser.setPermission', { permission: { name: 'clipboard-read' }, setting: 'prompt', origin })
    await call('Browser.setPermission', { permission: { name: 'clipboard-write' }, setting: 'prompt', origin })
  }
}

export async function assertDisplayFailureWitnesses(ports) {
  await ports.evaluate(`(()=>{const code=document.querySelector('.hex-value-controls code');window.savedIdentifierParts=[...code.childNodes];const visible=document.createElement('span');visible.textContent=code.title.slice(0,6)+'...'+code.title.slice(-4);visible.setAttribute('aria-hidden','true');const hidden=document.createElement('span');hidden.className='visually-hidden';hidden.textContent=code.title;code.replaceChildren(visible,hidden)})()`)
  try { await assert.rejects(() => assertDisplayedValues(ports), /DOM extraction must contain the exact value once/) }
  finally { await ports.evaluate(`document.querySelector('.hex-value-controls code').replaceChildren(...window.savedIdentifierParts)`) }
  await ports.evaluate(`document.querySelector('.hex-value').setAttribute('aria-disabled','true')`)
  try { await assert.rejects(() => assertDisplayedValues(ports), /read-only copy is enabled in the accessibility tree/) }
  finally { await ports.evaluate(`document.querySelector('.hex-value').removeAttribute('aria-disabled')`) }
}

async function assertFeedbackPresentation(evaluate) {
  const boxes = await evaluate(`[...document.querySelectorAll('.error-feedback')].map(box=>{const style=getComputedStyle(box),message=box.querySelector('.feedback-message'),text=getComputedStyle(message);return {kind:box.dataset.kind,role:box.getAttribute('role'),geometry:[style.padding,style.margin,style.borderWidth,style.borderStyle,style.borderRadius],typography:[text.fontFamily,text.fontSize,text.fontWeight,text.lineHeight],background:style.backgroundColor,border:style.borderInlineStartColor,overflow:box.scrollWidth>box.clientWidth+1}})`)
  assert(boxes.length > 0, 'the fixture exercises feedback')
  const first = boxes[0]
  const severities = new Map()
  for (const box of boxes) {
    assert.deepEqual(box.geometry, first.geometry, 'feedback variants share box geometry')
    assert.deepEqual(box.typography, first.typography, 'feedback variants share message typography')
    assert.equal(box.role, box.kind === 'error' ? 'alert' : 'status', 'feedback retains its announcement role')
    assert(!box.overflow, 'feedback content fits its container')
    const colors = JSON.stringify([box.background, box.border])
    if (severities.has(box.kind)) assert.equal(colors, severities.get(box.kind), 'severity colors do not depend on the feedback caller')
    severities.set(box.kind, colors)
  }
  assert.deepEqual([...severities.keys()].sort(), ['error', 'status', 'warning'], 'the fixture exercises every severity')
  assert.equal(new Set(severities.values()).size, severities.size, 'severity variants remain visually distinct')
}

export async function assertManualCopyRecovery({ call, evaluate, wait }) {
  const expected = await evaluate(`document.querySelector('.hex-value-controls code').title`)
  await evaluate(`Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async()=>{throw new DOMException('Clipboard denied','NotAllowedError')}}});document.querySelector('.hex-copy').focus()`)
  await call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r', unmodifiedText: '\r' })
  await call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
  await wait(`!!document.querySelector('.hex-copy-error')`)
  assert(await evaluate(`document.activeElement===document.querySelector('.hex-copy')`), 'copy failure does not steal focus')
  await call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 })
  await call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 })
  assert(await evaluate(`(()=>{const field=document.querySelector('.hex-copy-error input');return field!==null&&document.activeElement===field&&field.readOnly&&!field.disabled&&!!field.getAttribute('aria-label')})()`), 'Tab reaches a named read-only recovery field')
  await call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'a', code: 'KeyA', modifiers: 2, windowsVirtualKeyCode: 65 })
  await call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA', modifiers: 2, windowsVirtualKeyCode: 65 })
  const selected = await evaluate(`(()=>{const field=document.querySelector('.hex-copy-error input');return {value:field.value,start:field.selectionStart,end:field.selectionEnd,message:field.parentElement.textContent}})()`)
  assert.equal(selected.value, expected, 'manual recovery preserves the exact original value')
  assert.equal(selected.start, 0, 'native Select All starts at the first character')
  assert.equal(selected.end, expected.length, 'native Select All includes the entire value')
  assert(selected.message.includes('Select and copy') && selected.message.includes('Clipboard denied'), 'recovery retains its instruction and original failure cause')
  await call('Emulation.setDeviceMetricsOverride', { width: 320, height: 900, deviceScaleFactor: 1, mobile: true })
  await wait('innerWidth===320')
  assert(await evaluate(`document.documentElement.scrollWidth<=innerWidth&&document.querySelector('.hex-copy-error input').readOnly`), 'copy failure remains selectable and fits a narrow viewport')
  await call('Emulation.clearDeviceMetricsOverride', {})
}

export async function assertContentSeparation(evaluate) {
  const layout = await evaluate(`(()=>{const border=node=>parseFloat(getComputedStyle(node).borderTopWidth);return {facts:[...document.querySelectorAll('.key-value')].map(node=>({label:node.querySelector('dt')?.textContent,top:border(node)})),sections:[...document.querySelectorAll('.elements > .ui-section')].map(node=>({leading:node.previousElementSibling===null,afterPeer:node.previousElementSibling?.matches('.ui-section')===true,top:border(node)})),nested:[...document.querySelectorAll('.ui-section .ui-section')].map(node=>{
    const style=getComputedStyle(node),parent=node.parentElement.closest('.ui-section');
    const heading=node.querySelector(':scope > :is(h2,h3,h4,h5,h6)'),parentHeading=parent.querySelector(':scope > :is(h2,h3,h4,h5,h6)');
    return {top:border(node),inlineBorder:parseFloat(style.borderInlineStartWidth),indent:parseFloat(style.paddingInlineStart),spacing:parseFloat(style.marginBlockStart),headingLevel:heading===null?null:Number(heading.tagName.slice(1)),parentHeadingLevel:parentHeading===null?null:Number(parentHeading.tagName.slice(1))};
  }),cards:[...document.querySelectorAll('.nft-row')].map(node=>({top:border(node),left:parseFloat(getComputedStyle(node).borderLeftWidth)})),details:[...document.querySelectorAll('.nft-details')].map(border),overflow:document.documentElement.scrollWidth>innerWidth}})()`)
  assert(layout.facts.length > 0 && layout.sections.length > 1 && layout.nested.length > 0 && layout.cards.length > 0 && layout.details.length > 0, 'the fixture exercises ordinary, nested and NFT grouping')
  for (const fact of layout.facts) assert.equal(fact.top, 0, `facts use spacing rather than dividers: ${fact.label}`)
  assert(layout.sections.some(section=>section.leading) && layout.sections.some(section=>!section.leading&&!section.afterPeer) && layout.sections.some(section=>section.afterPeer), 'the fixture exercises leading sections, groups after flat content and adjacent peers')
  for (const section of layout.sections) assert.equal(section.top > 0, !section.leading, 'new sections separate earlier content; leading sections have no top divider')
  for (const nested of layout.nested) {
    assert(nested.top === 0 && nested.inlineBorder === 0 && nested.indent === 0, 'nested groups have no ornamental border or indentation')
    assert(nested.spacing > 0, 'nested groups retain vertical spacing')
    assert(nested.headingLevel !== null && nested.parentHeadingLevel !== null && nested.headingLevel === Math.min(nested.parentHeadingLevel + 1, 6), 'nested group headings retain their semantic hierarchy')
  }
  for (const card of layout.cards) assert(card.top > 0 && card.left > 0, 'NFT card boundaries remain distinct from fact-row dividers')
  for (const top of layout.details) assert(top > 0, 'preview and identity remain distinct content regions')
  assert(!layout.overflow, 'group boundaries fit the current viewport')
}

export async function assertNumericValidationPresentation({ evaluate, wait }) {
  const names = await evaluate(`[...document.querySelectorAll('input[inputmode]')].map(input=>input.name)`)
  assert(names.length > 0, 'the fixture exercises numeric controls')
  for (const name of names) {
    const selector = `input[name=${JSON.stringify(name)}]`
    async function editorPresentation() {
      return evaluate(`(()=>{
        const input=document.querySelector(${JSON.stringify(selector)});
        const group=input.closest('fieldset');
        const editor=group===null?input.closest('label.field').parentElement:group;
        function visibleTree(element){
          const bounds=element.getBoundingClientRect(),style=getComputedStyle(element);
          if(bounds.width<=1||bounds.height<=1||style.display==='none'||style.visibility!=='visible')return null;
          const text=element.matches('input,textarea,select')?'':[...element.childNodes].filter(node=>node.nodeType===Node.TEXT_NODE).map(node=>node.textContent).join('').replace(/\\s+/gu,' ').trim();
          return {tag:element.tagName,text,children:[...element.children].map(visibleTree).filter(child=>child!==null)};
        }
        const bounds=editor.getBoundingClientRect();
        return {width:bounds.width,height:bounds.height,tree:visibleTree(editor)};
      })()`)
    }
    const initialEditor = await editorPresentation()
    async function enter(value) {
      await evaluate(`(()=>{const input=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(value)});input.dispatchEvent(new Event('input',{bubbles:true}))})()`)
    }
    async function presentation(invalid) {
      await wait(`document.querySelector(${JSON.stringify(selector)}).getAttribute('aria-invalid')===${JSON.stringify(String(invalid))}`)
      const current = await evaluate(`(()=>{const input=document.querySelector(${JSON.stringify(selector)}),probe=document.createElement('span');probe.style.color='var(--danger)';document.body.append(probe);const danger=getComputedStyle(probe).color;probe.remove();const describedBy=input.getAttribute('aria-describedby');const ids=describedBy===null?[]:describedBy.split(' ').filter(Boolean);return {red:getComputedStyle(input).borderTopColor===danger,value:input.value,descriptions:ids.map(id=>{const node=document.getElementById(id),r=node?.getBoundingClientRect();return {text:node?.textContent,visible:r!==undefined&&r.width>1&&r.height>1}})}})()`)
      assert.equal(current.red, invalid, 'the rendered border follows semantic invalidity')
      for (const description of current.descriptions) assert(!description.visible && description.text, 'numeric causes remain accessible without visible commentary')
      if (invalid) assert(current.descriptions.length > 0, 'invalid numeric input has an accessible cause')
      assert.deepEqual(await editorPresentation(), initialEditor, 'numeric editor visible content and size stay stable across draft states')
      return current
    }
    await enter('not-a-number')
    await presentation(true)
    await enter('0')
    await presentation(false)
    await evaluate(`(()=>{const input=document.querySelector(${JSON.stringify(selector)}),transfer=new DataTransfer();transfer.setData('text/plain',${JSON.stringify('1\n2')});input.dispatchEvent(new ClipboardEvent('paste',{clipboardData:transfer,bubbles:true,cancelable:true}))})()`)
    assert.equal((await presentation(true)).value, '', 'rejected multiline input is cleared but remains visibly invalid')
    await enter('0')
    await presentation(false)
    await evaluate(`document.querySelector(${JSON.stringify(selector)}).dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true,data:''}))`)
    await presentation(false)
    await evaluate(`document.querySelector(${JSON.stringify(selector)}).dispatchEvent(new CompositionEvent('compositionend',{bubbles:true,data:'0'}))`)
    await presentation(false)
  }
}
