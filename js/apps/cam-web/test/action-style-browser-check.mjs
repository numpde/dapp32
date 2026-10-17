import assert from 'node:assert/strict'

export async function checkActionStyles({ call, evaluate, viewerURL }) {
  const fixture = new URL('/test/action-style-fixture.html', viewerURL)
  fixture.search = new URL(viewerURL).search
  async function wait(expression) {
    const deadline = Date.now() + 10000
    while (Date.now() < deadline) {
      if (await evaluate(expression)) return
      await new Promise(resolve => setTimeout(resolve, 50))
    }
    throw new Error(`Action fixture did not reach: ${expression}`)
  }
  try {
    await call('Page.navigate', { url: fixture.href })
    await wait(`!!window.actionFixture&&document.querySelectorAll('.elements .action-button').length===6`)
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
      const commands = [...document.querySelectorAll('.action-button:not(:disabled), .wallet-button, .document-hash-field button')]
        .filter(button => button.textContent !== 'Cancel calculation')
      const reference = signature(commands[0])
      const quiet = [...document.querySelectorAll('.ui-meta>button, .prepared-call>button:not(.send-button)')]
      quiet.push([...document.querySelectorAll('.document-hash-field button')].find(button => button.textContent === 'Cancel calculation'))
      const send = getComputedStyle(document.querySelector('.send-button'))
      const command = getComputedStyle(commands[0])
      return {
        commandsConsistent: commands.every(button => signature(button) === reference),
        commandsOutlined: command.backgroundColor !== command.borderColor && command.borderStyle === 'solid',
        quietConsistent: quiet.every(button => signature(button) === signature(quiet[0])),
        quietDistinct: signature(quiet[0]) !== reference,
        quietUnfilled: quiet.every(button => getComputedStyle(button).backgroundColor === 'rgba(0, 0, 0, 0)' && getComputedStyle(button).borderColor === 'rgba(0, 0, 0, 0)'),
        sendFilled: send.backgroundColor === send.borderColor && send.backgroundColor !== command.backgroundColor,
        noAutomaticArrows: [...document.querySelectorAll('.action-button')].every(button => !button.querySelector('[aria-hidden]')),
      }
    })()`)
    assert(styles.commandsConsistent && styles.commandsOutlined, 'CAM, wallet and document commands share one outlined treatment regardless of route kind')
    assert(styles.quietConsistent && styles.quietDistinct && styles.quietUnfilled, 'Back, Refresh, Discard and Cancel share a quiet supporting treatment')
    assert(styles.sendFilled && styles.noAutomaticArrows, 'only Send is filled; CAM commands have no automatic route arrows')

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
    assert(await evaluate(`(() => {
      const button = document.querySelector('.timestamp-options')
      const bounds = button.getBoundingClientRect()
      return bounds.width === 60 && bounds.height === 32
        && window.actionFixture.events.send === 0 && window.actionFixture.events.contractCall === 1
    })()`), 'timestamp capsule retains its separate geometry and selection without preparing or sending')

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
        const appearance = button => {
          const style = getComputedStyle(button)
          return JSON.stringify([style.color, style.backgroundColor, style.borderColor, style.cursor])
        }
        return JSON.stringify(window.actionFixture.events) === before
          && commands.every(button => appearance(button) === appearance(commands[0]))
          && getComputedStyle(commands[0]).cursor === 'not-allowed'
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
    return { widths: [1280, 320], commandsConsistent: true, supportingQuiet: true, sendFilled: true, disabledAndBusyPreserved: true, nativeKeyboardUnverified: true }
  } finally {
    await call('Emulation.clearDeviceMetricsOverride', {})
    await call('Page.navigate', { url: viewerURL })
  }
}
