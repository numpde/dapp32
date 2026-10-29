import assert from 'node:assert/strict'

export async function assertSingleLineControlSizing(evaluate) {
  const controls = await evaluate(`Array.from(document.querySelectorAll('input,select,.address-control')).filter(element=>{
    if(!element.checkVisibility()||(element.tagName==='INPUT'&&element.closest('.address-control')))return false;
    const style=getComputedStyle(element),bounds=element.getBoundingClientRect();
    if(['absolute','fixed'].includes(style.position)&&bounds.width<=1&&bounds.height<=1)return false;
    return element.tagName!=='INPUT'||['text','url','email','tel','search','password','number'].includes(element.type);
  }).map(element=>({kind:element.tagName,name:element.getAttribute('name'),font:getComputedStyle(element).fontSize,height:element.getBoundingClientRect().height}))`)
  const heights = new Map()
  for (const control of controls) {
    if (!heights.has(control.font)) heights.set(control.font, control.height)
    assert(Math.abs(control.height - heights.get(control.font)) <= 1, `single-line controls with the same text size must share a height: ${JSON.stringify(controls)}`)
  }
}

export async function assertNoHiddenEditorLayout(evaluate) {
  const offenders = await evaluate(`(()=>{const editors=[...document.querySelectorAll('fieldset')];return editors.flatMap(editor=>[...editor.querySelectorAll('*')].filter(element=>{
    const style=getComputedStyle(element),bounds=element.getBoundingClientRect();
    if((style.visibility!=='hidden'&&style.visibility!=='collapse'&&!element.hidden)||bounds.width<=1||bounds.height<=1)return false;
    for(let ancestor=element;ancestor&&ancestor!==editor;ancestor=ancestor.parentElement){if(['absolute','fixed'].includes(getComputedStyle(ancestor).position))return false}
    return true;
  }).map(element=>({editor:editor.querySelector('legend')?.textContent,element:element.tagName,role:element.getAttribute('role')})))})()`)
  assert.deepEqual(offenders, [], 'invisible editor content must not reserve layout space')
}

export async function assertHiddenEditorLayoutWitnesses(evaluate) {
  await evaluate(`(()=>{const probe=document.createElement('div');probe.dataset.layoutWitness='';probe.style.cssText='visibility:hidden;height:72px';document.querySelector('fieldset').append(probe)})()`)
  try { await assert.rejects(() => assertNoHiddenEditorLayout(evaluate), /invisible editor content/) }
  finally { await evaluate(`document.querySelector('[data-layout-witness]').remove()`) }
  await evaluate(`(()=>{const probe=document.createElement('div');probe.dataset.layoutWitness='';probe.innerHTML='<span class="visually-hidden">Accessible description</span><div hidden>Inactive content</div><div style="position:absolute;visibility:hidden;width:72px;height:72px">Overlay</div>';document.querySelector('fieldset').append(probe)})()`)
  try { await assertNoHiddenEditorLayout(evaluate) }
  finally { await evaluate(`document.querySelector('[data-layout-witness]').remove()`) }
}

// Adapted from nmr-gui-v1/tests/e2e/layout-stability.mjs at df172527409c.
// The transition must expose the intermediate state; completed content growth
// is intentional and belongs outside this state-only comparison.
export async function assertStableLayout(evaluate, anchors, transition, context) {
  assert(Object.keys(anchors).length > 0, `${context}: no layout anchors`)
  const before = await measure(evaluate, anchors, context)
  await transition()
  const after = await measure(evaluate, anchors, context)
  for (const name of Object.keys(anchors)) {
    assert.deepEqual(after[name], before[name], `${context}: ${name} moved or resized`)
  }
}

async function measure(evaluate, anchors, context) {
  const measurements = await evaluate(`Object.fromEntries(Object.entries(${JSON.stringify(anchors)}).map(([name,selector])=>{
    const matches=document.querySelectorAll(selector)
    const element=matches[0]
    const bounds=element?.getBoundingClientRect()
    return [name,{count:matches.length,visible:!!element?.getClientRects().length&&getComputedStyle(element).visibility!=='hidden',
      bounds:bounds&&{x:bounds.x,y:bounds.y,width:bounds.width,height:bounds.height}}]
  }))`)
  const result = {}
  for (const name of Object.keys(anchors)) {
    const measurement = measurements[name]
    assert.equal(measurement.count, 1, `${context}: ${name} must identify one element`)
    assert(measurement.visible && measurement.bounds.width > 0 && measurement.bounds.height > 0,
      `${context}: ${name} must be visible with measurable bounds`)
    result[name] = measurement.bounds
  }
  return result
}
