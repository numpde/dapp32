import assert from 'node:assert/strict'
import { assertStableLayout } from './layout-stability.mjs'
import { finishDisplayFixture } from './escrow-browser-fixture.mjs'

export async function checkActionStyles({ call, evaluate, viewerURL }) {
  const fixture = new URL('/test/action-style-fixture.html', viewerURL)
  fixture.search = new URL(viewerURL).search
  async function wait(expression) {
    const deadline = Date.now() + 10000
    while (Date.now() < deadline) {
      if (await evaluate(expression)) return
      await new Promise(resolve => setTimeout(resolve, 50))
    }
    assert.fail(`Action fixture did not reach: ${expression}`)
  }
  const failures = []
  try {
    await call('Page.navigate', { url: fixture.href })
    await wait(`!!window.actionFixture&&document.querySelectorAll('.elements .action-button').length===6`)
    assert(await evaluate(`(() => {
      const connection=document.querySelector('section[aria-label="Account and wallet"]')
      const labels=[...connection.querySelectorAll('dt')]
      const value=label=>labels.find(term=>term.textContent===label)?.nextElementSibling
      return !connection.querySelector('details')
        && value('Viewing as')?.querySelector('.hex-short')?.textContent==='0x1111...1111'
        && value('Signing wallet')?.querySelector('.hex-short')?.textContent==='0x2222...2222'
        && value('Chain')?.textContent==='eip155:31337'
        && value('CAM contract')?.querySelector('.hex-short')?.textContent==='0x3333...3333'
        && ['Viewing as','Signing wallet','Chain','CAM contract'].every(label=>value(label)?.getClientRects().length>0)
        && !!value('Signing wallet').querySelector('[role="status"]')
        && !connection.querySelector('.wallet-button').disabled
    })()`), 'account, wallet, chain and contract facts are visible without expansion, with the wallet action available')
    await evaluate(`Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async value=>{window.copiedIdentifier=value}}});document.querySelector('button[aria-label="Copy viewing address"]').click()`)
    await wait(`document.querySelector('.connection-facts [role="status"]').textContent==='viewing address copied'`)
    assert.equal(await evaluate('window.copiedIdentifier'), '0x1111111111111111111111111111111111111111', 'copy writes the exact full address rather than its shortened display')
    assert(await evaluate(`document.querySelector('.hex-value code').title===window.copiedIdentifier`), 'the full value is available on pointer hover')
    const accessibility = await call('Accessibility.getFullAXTree', {})
    assert(accessibility.nodes.some(node => !node.ignored && node.role?.value === 'StaticText' && node.name?.value === '0x1111111111111111111111111111111111111111'), 'assistive technology receives the exact full address')
    await evaluate(`navigator.clipboard.writeText=()=>new Promise(resolve=>{window.finishOldCopy=resolve});document.querySelector('button[aria-label="Copy viewing address"]').click();window.actionFixture.account('0x4444444444444444444444444444444444444444')`)
    await wait(`document.querySelector('.hex-value .hex-short').textContent==='0x4444...4444'`)
    await evaluate('window.finishOldCopy()')
    assert(await evaluate(`!document.querySelector('.hex-value [role="status"]').textContent`), 'a late copy completion does not acknowledge a different displayed address')
    await evaluate(`navigator.clipboard.writeText=async()=>{throw new DOMException('Clipboard denied','NotAllowedError')};document.querySelector('button[aria-label="Copy viewing address"]').click()`)
    await wait(`!!document.querySelector('.hex-copy-error')`)
    assert(await evaluate(`document.querySelector('.hex-copy-error code').textContent==='0x4444444444444444444444444444444444444444'&&document.querySelector('.hex-copy-error').textContent.includes('Select and copy')`), 'clipboard failure exposes the exact selectable value for manual recovery')
    await call('Emulation.setDeviceMetricsOverride', { width: 320, height: 900, deviceScaleFactor: 1, mobile: false })
    assert(await evaluate(`document.documentElement.scrollWidth<=innerWidth&&getComputedStyle(document.querySelector('.hex-copy-error code')).userSelect!=='none'`), 'copy failure remains selectable and fits a narrow viewport')
    await call('Emulation.clearDeviceMetricsOverride', {})
    await evaluate(`window.actionFixture.account('0x1111111111111111111111111111111111111111')`)
    await evaluate(`document.querySelector('.wallet-button').click()`)
    assert(await evaluate(`window.actionFixture.events.wallet===1&&window.actionFixture.events.send===0`), 'wallet connection remains usable without sending a transaction')
    assert(await evaluate(`(() => { const group=document.querySelector('section[aria-label="Fixture actions"]');return group?.querySelector('h2')?.textContent==='Fixture actions'&&!!group.querySelector('input[name="draft"]')&&group.querySelectorAll('.action-button').length===6 })()`), 'a declared group keeps its heading, inputs and commands together')
    assert(await evaluate(`
      [...document.querySelectorAll('button')].every(button =>
        button.type === 'button' && !button.hasAttribute('href') && !button.hasAttribute('role'))
    `), 'commands retain native button semantics')

    await evaluate(`document.querySelectorAll('.action-button')[0].click()`)
    await wait(`window.actionFixture.events.navigate===1`)
    assert(await evaluate(`!document.querySelector('.prepared-call')&&window.actionFixture.events.send===0`), 'read actions never prepare or send')
    await evaluate(`document.querySelectorAll('.action-button')[1].click()`)
    await wait(`!!document.querySelector('.prepared-call')`)
    assert(await evaluate(`window.actionFixture.events.contractCall===1&&window.actionFixture.events.send===0`), 'write actions only prepare review')
    assert(await evaluate(`(()=>{const row=label=>[...document.querySelectorAll('.prepared-call .key-value')].find(row=>row.firstElementChild.textContent===label)?.lastElementChild;return row('Input: payload (bytes)').textContent==='0x'+'ab'.repeat(32)&&!row('Input: payload (bytes)').querySelector('.hex-value')&&row('Input: digest (bytes32)').querySelector('.hex-short').textContent==='0xabab...abab'&&row('Input: owner (address)').querySelector('.hex-short').textContent==='0x1111...1111'&&[...document.querySelectorAll('.elements .key-value')].find(row=>row.firstElementChild.textContent==='Document digest').querySelector('.hex-short').textContent==='0xabab...abab'})()`), 'generic status and transaction identifiers share compact displays while dynamic calldata stays exact and unshortened')

    const styles = await evaluate(`(() => {
      const signature = element => {
        const style = getComputedStyle(element)
        return JSON.stringify([style.color, style.backgroundColor, style.borderColor,
          style.borderStyle, style.borderWidth, style.borderRadius, style.padding, style.minHeight])
      }
      const [read,write] = document.querySelectorAll('.action-button')
      const reference = signature(write)
      const quiet = [...document.querySelectorAll('.ui-meta>button, .prepared-call>button:not(.send-button)')]
      quiet.push([...document.querySelectorAll('.document-hash-field button')].find(button => button.textContent === 'Cancel calculation'))
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
    assert(styles.quietDistinct && styles.quietUnfilled, 'Back, Refresh, Discard and Cancel have a quiet supporting treatment')
    assert(styles.sendFilled, 'only Send is filled')

    assert(await evaluate(`(() => {
      const controls = [...document.querySelectorAll('.ui-meta>button, .ui-meta>details>summary')]
      const tops = controls.map(control => {
        const range = document.createRange()
        range.selectNodeContents(control)
        return range.getBoundingClientRect().top
      })
      return Math.max(...tops) - Math.min(...tops) <= 1
    })()`), 'toolbar actions and details share a text baseline')

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
      await wait(`document.querySelector('.elements').disabled`)
      assert(await evaluate(`(() => {
        const before = JSON.stringify(window.actionFixture.events)
        for (const button of document.querySelectorAll('.elements button, .wallet-button, .ui-meta>button')) {
          if (!button.matches(':disabled')) return false
          button.click()
        }
        const commands = [...document.querySelectorAll('.action-button, .wallet-button, .document-hash-field button:not(.button-quiet)')]
        return JSON.stringify(window.actionFixture.events) === before
          && commands.every(button => getComputedStyle(button).cursor === 'not-allowed')
      })()`), `${state} preserves inherited fieldset and shell interaction guards`)
      await evaluate(`window.actionFixture.${state}(false)`)
      await wait(`!document.querySelector('.elements').disabled`)
    }
    for (const width of [1280, 320]) {
      await call('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width === 320 })
      await evaluate(`window.actionFixture.hashPhase('idle')`)
      await wait(`!document.querySelector('.document-hash-field button[aria-busy="true"]')`)
      const anchors = { digest: 'input[name="document"]', field: '.document-hash-field', following: '.elements>.key-value:last-child' }
      for (const phase of ['pending', 'succeeded', 'idle']) {
        await assertStableLayout(evaluate, anchors, async () => {
          await evaluate(`window.actionFixture.hashPhase('${phase}')`)
          await wait(`document.querySelector('.document-hash-field button[aria-busy="true"]')!==null === ${phase === 'pending'}`)
        }, `${width}px document hash ${phase}`)
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
    }
    const transactionHash = `0x${'ab'.repeat(32)}`
    await evaluate(`window.actionFixture.transaction('eip155:43113',${JSON.stringify(transactionHash)})`)
    await wait(`!!document.querySelector('.transaction-feedback a')`)
    assert(await evaluate(`(() => {const link=document.querySelector('.transaction-feedback a');return link.href===${JSON.stringify(`https://testnet.snowtrace.io/tx/${transactionHash}`)}&&link.querySelector('.hex-short').textContent==='0xabab...abab'&&link.querySelector('code').title===${JSON.stringify(transactionHash)}&&link.target==='_blank'&&link.rel.includes('noopener')&&document.querySelector('.transaction-feedback').textContent.includes('Receipt wait timed out.')})()`), 'uncertain confirmation retains its cause and links the exact submitted hash on its own chain, independently of the viewer chain')
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
    return { widths: [1280, 320], actionKindsDistinct: true, supportingQuiet: true, sendFilled: true, disabledAndBusyPreserved: true, transactionExplorer: true, nativeKeyboardUnverified: true }
  } catch (error) {
    failures.push(error)
  } finally {
    await finishDisplayFixture({ call, evaluate, viewerURL, failures })
  }
}
