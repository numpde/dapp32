import assert from 'node:assert/strict'
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
        && value('Viewing as')?.textContent==='0x1111111111111111111111111111111111111111'
        && value('Signing wallet')?.textContent.includes('0x2222222222222222222222222222222222222222')
        && value('Chain')?.textContent==='eip155:31337'
        && value('CAM contract')?.textContent==='0x3333333333333333333333333333333333333333'
        && ['Viewing as','Signing wallet','Chain','CAM contract'].every(label=>value(label)?.getClientRects().length>0)
        && !!value('Signing wallet').querySelector('[role="status"]')
        && !connection.querySelector('.wallet-button').disabled
    })()`), 'account, wallet, chain and contract facts are visible without expansion, with the wallet action available')
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
    return { widths: [1280, 320], actionKindsDistinct: true, supportingQuiet: true, sendFilled: true, disabledAndBusyPreserved: true, nativeKeyboardUnverified: true }
  } catch (error) {
    failures.push(error)
  } finally {
    await finishDisplayFixture({ call, evaluate, viewerURL, failures })
  }
}
