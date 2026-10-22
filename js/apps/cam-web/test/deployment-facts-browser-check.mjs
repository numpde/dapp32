import assert from 'node:assert/strict'

export async function checkDeploymentFacts({ call, evaluate }) {
  const original = await evaluate('({ href:location.href, role:document.getElementById("local-fixture-wallet-role").value })')
  async function wait(expression) {
    const deadline = Date.now() + 30000
    while (Date.now() < deadline) {
      if (await evaluate(expression)) return
      await new Promise(resolve => setTimeout(resolve, 50))
    }
    assert.fail(`Deployment facts did not reach: ${expression}`)
  }
  const failures = []
  let records
  try {
    assert(await evaluate(`!!document.getElementById('local-fixture-facts')`), 'attached fixture wallet offers deployment facts')
    await evaluate(`document.querySelector('#local-fixture-facts').open=true`)
    await wait(`document.querySelector('#local-fixture-facts [role="status"]')?.textContent.startsWith('Checked at block')`)
    records = await evaluate(`({ heading:document.querySelector('#local-fixture-facts h3').textContent, rows:[...document.querySelectorAll('#local-fixture-facts section')].map(row=>({label:row.querySelector('strong').textContent,href:row.querySelector('a').href})) })`)
    assert(records.rows.length <= 20)
    for (const row of records.rows) {
      const link = new URL(row.href)
      assert.equal(link.origin + link.pathname + link.search, new URL(original.href).origin + new URL(original.href).pathname + new URL(original.href).search, 'links preserve connection settings')
      assert(new URLSearchParams(link.hash.slice(1)).has('route'))
    }
    await evaluate(`document.querySelector('#local-fixture-facts button').click()`)
    await wait(`document.querySelector('#local-fixture-facts [role="status"]')?.textContent.startsWith('Checked at block')`)
    if (records.rows.length > 0) {
      const connection = await evaluate(`(() => { const selector=document.getElementById('local-fixture-wallet-role');const role=[...selector.options].find(option=>option.value!==selector.value).value;window.__fixtureWallet.setRole(role);return {role,address:document.querySelector('#local-fixture-wallet input[readonly][aria-label="Selected account address"]').value} })()`)
      await wait(`document.querySelector('#local-fixture-facts [role="status"]')?.textContent.startsWith('Checked at block')`)
      await evaluate(`document.querySelector('.wallet-button').click()`)
      await wait(`new URL(location.href).searchParams.get('account')?.toLowerCase()===${JSON.stringify(connection.address.toLowerCase())}&&!document.querySelector('.wallet-button').disabled&&!document.querySelector('.elements').disabled`)
      const currentLink = new URL(await evaluate(`document.querySelector('#local-fixture-facts section a').href`))
      assert.equal(currentLink.search, new URL(await evaluate('location.href')).search, 'record links keep the current connection after wallet synchronization')
      const link = currentLink
      const route = new URLSearchParams(link.hash.slice(1)).get('route')
      const documentStart = await evaluate('performance.timeOrigin')
      await evaluate(`document.querySelector('#local-fixture-facts section a').click()`)
      await wait(`location.hash===${JSON.stringify(link.hash)}&&[...document.querySelectorAll('.ui-meta .key-value')].some(row=>row.firstElementChild.textContent==='Read route'&&row.lastElementChild.textContent===${JSON.stringify(route)})&&!document.querySelector('.elements').disabled`)
      assert.equal(await evaluate('location.hash'), link.hash)
      assert.equal(await evaluate('performance.timeOrigin'), documentStart, 'opening a record must preserve the connected document')
      assert.equal((await evaluate('new URL(location.href).searchParams.get("account")')).toLowerCase(), connection.address.toLowerCase(), 'opening a record must preserve the connected account')
      assert(await evaluate(`!document.querySelector('.prepared-call')`), 'opening a record does not prepare a transaction')
    }
    return { ...records, navigation: records.rows.length > 0 }
  } catch (error) { failures.push(error) }
  finally {
    try {
      await call('Page.navigate', { url: original.href })
      await wait(`!!window.__fixtureWallet&&!!document.querySelector('.elements')`)
      await evaluate(`window.__fixtureWallet.setRole(${JSON.stringify(original.role)});document.getElementById('local-fixture-facts').open=true`)
      await wait(`document.querySelector('#local-fixture-facts [role="status"]')?.textContent.startsWith('Checked at block')`)
    } catch (error) { failures.push(error) }
    if (failures.length === 1) throw failures[0]
    if (failures.length > 1) throw new AggregateError(failures, 'Deployment facts check and restoration failures')
  }
}
