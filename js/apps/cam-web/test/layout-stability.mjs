import assert from 'node:assert/strict'

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
