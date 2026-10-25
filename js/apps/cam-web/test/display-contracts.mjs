import assert from 'node:assert/strict'

export async function assertDisplayedValues({ call, evaluate }) {
  const rows = await evaluate(`(()=>{const rows=[...document.querySelectorAll('dl')];return rows.map(row=>{const outer=row.parentElement.closest('dl');return {tags:[...row.children].map(child=>child.tagName),invalidParent:outer!==null&&row.parentElement.closest('dd')?.parentElement!==outer,label:row.firstElementChild?.textContent,overflow:row.scrollWidth>row.clientWidth+1}})})()`)
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
    assert(item.decorative && item.ellipsis.includes('...') && item.middleFits, 'middle shortening is visible and decorative')
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
