import assert from 'node:assert/strict'
import { assertStableLayout } from './layout-stability.mjs'
import { finishDisplayFixture, navigateBrowserDocument, waitForBrowserCondition } from './escrow-browser-fixture.mjs'
import { assertBuildFooter, assertDisplayedValues, assertDisplayFailureWitnesses, assertNativeIdentifierCopy, assertManualCopyRecovery, assertNumericValidationPresentation } from './display-contracts.mjs'

export async function checkActionStyles({ call, evaluate, viewerURL }) {
  const fixture = new URL('/test/action-style-fixture.html', viewerURL)
  fixture.search = new URL(viewerURL).search
  const wait = expression => waitForBrowserCondition(() => evaluate(expression), `action fixture: ${expression}`)
  const failures = []
  try {
    await navigateBrowserDocument({ call, url: fixture.href, description: 'the action fixture',
      ready: () => evaluate(`!!window.actionFixture&&document.querySelectorAll('.elements .action-button').length===6`) })
    await evaluate(`document.querySelector('.nft-row .resource-load').click()`)
    await wait(`document.querySelector('.nft-row img')?.naturalWidth===2`)
    assert(await evaluate(`(() => {
      const connection=document.querySelector('section[aria-label="Account and wallet"]')
      const labels=[...connection.querySelectorAll('dt')]
      const value=label=>labels.find(term=>term.textContent===label)?.nextElementSibling
      return !connection.querySelector('details')
        && value('Viewing as')?.querySelector('code')?.textContent==='0x1111111111111111111111111111111111111111'
        && value('Signing wallet')?.querySelector('code')?.textContent==='0x2222222222222222222222222222222222222222'
        && value('Chain')?.textContent==='eip155:31337'
        && value('CAM contract')?.querySelector('code')?.textContent==='0x3333333333333333333333333333333333333333'
        && ['Viewing as','Signing wallet','Chain','CAM contract'].every(label=>value(label)?.getClientRects().length>0)
        && !!value('Signing wallet').querySelector('[role="status"]')
        && !connection.querySelector('.wallet-button').disabled
    })()`), 'account, wallet, chain and contract facts are visible without expansion, with the wallet action available')
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
    await evaluate(`navigator.clipboard.writeText=()=>new Promise(resolve=>{window.finishOldCopy=resolve});document.querySelector('.hex-copy').click();window.actionFixture.account('0x4444444444444444444444444444444444444444')`)
    await wait(`document.querySelector('.hex-value code').textContent==='0x4444444444444444444444444444444444444444'`)
    await evaluate('window.finishOldCopy()')
    assert(await evaluate(`!document.querySelector('.hex-value [role="status"]').textContent`), 'a late copy completion does not acknowledge a different displayed address')
    await assertManualCopyRecovery({ call, evaluate, wait })
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
    assert(await evaluate(`(()=>{const raw=[...document.querySelectorAll('.prepared-call .key-value')].filter(row=>row.firstElementChild.textContent.endsWith('(bytes)'));return raw.length>0&&raw.every(row=>row.lastElementChild.textContent==='0x'+'ab'.repeat(32)&&!row.querySelector('.hex-value'))})()`), 'dynamic calldata stays exact and unshortened')

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
    assert(await evaluate(`document.querySelector('.prepared-call .review-json').textContent===actionFixture.reviewJson&&document.querySelector('.prepared-call textarea[readonly]').value===actionFixture.reviewURI`), 'review decodes embedded JSON exactly while retaining the full URI')
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
