// Owns local acceptance-runner keys, submission effects and CDP command lifetime.
import assert from 'node:assert/strict'
import { checkDeploymentFacts } from './deployment-facts-browser-check.mjs'
import { privateKeyToAccount } from 'viem/accounts'
import { viewerErrorMessage } from '@cam/viewer'

export class BrowserFixtureError extends Error {}

export async function checkFixtureWalletToolbar({ call, evaluate }) {
  const scroll = await evaluate(`(() => { const app=document.getElementById('root');return {x:app.scrollLeft,y:app.scrollTop,hasFacts:!!document.getElementById('local-fixture-facts')} })()`)
  const failures = []
  let wideHeight
  let facts
  try {
    if (scroll.hasFacts === true) facts = await checkDeploymentFacts({ call, evaluate })
    await evaluate(`(() => { const filler=document.createElement('div');filler.id='wallet-toolbar-scroll-test';filler.style.height='200vh';document.getElementById('root').append(filler) })()`)
    for (const [width, height] of [[1280, 900], [320, 900], [320, 320], [320, 256]]) {
      await call('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: true })
      await call('Page.captureScreenshot', { format: 'jpeg', quality: 10, captureBeyondViewport: false })
      const headerHeight = await evaluate(`document.getElementById('local-fixture-wallet').getBoundingClientRect().height`)
      if (width === 1280) wideHeight = headerHeight
      else if (height === 900) assert(headerHeight > wideHeight, 'wallet header wraps at narrow width')
      if (scroll.hasFacts === true) assert(await evaluate(`(() => { const panel=document.getElementById('local-fixture-facts');panel.scrollTop=0;const summary=panel.querySelector('summary').getBoundingClientRect();const bounds=panel.getBoundingClientRect();return panel.clientHeight>=summary.height&&summary.top>=bounds.top&&summary.bottom<=bounds.bottom+1 })()`), 'deployment disclosure remains visible in a short viewport')
      await evaluate(`document.getElementById('root').scrollTo(0,0)`)
      assert(await evaluate(`(() => { const bar=document.getElementById('local-fixture-wallet').getBoundingClientRect();const app=document.getElementById('root');const bounds=app.getBoundingClientRect();return bounds.top>=bar.bottom-1&&bounds.bottom<=innerHeight+1&&app.clientHeight>0&&app.scrollHeight>app.clientHeight })()`), 'app has its own bounded scroll area below the wallet header')
      await evaluate(`document.getElementById('root').scrollTo(0,300)`)
      await call('Page.captureScreenshot', { format: 'jpeg', quality: 10, captureBeyondViewport: false })
      assert(await evaluate(`(() => { const bar=document.getElementById('local-fixture-wallet').getBoundingClientRect();const app=document.getElementById('root');return app.scrollTop>0&&scrollY===0&&Math.abs(bar.top)<1&&bar.left>=0&&bar.right<=innerWidth+1&&app.getBoundingClientRect().top>=bar.bottom-1 })()`), 'only the app scrolls; its content never passes behind the wallet header')
    }
  } catch (error) {
    failures.push(error)
  } finally {
    try { await call('Emulation.clearDeviceMetricsOverride', {}) } catch (error) { failures.push(error) }
    try { await evaluate(`document.getElementById('wallet-toolbar-scroll-test')?.remove();document.getElementById('root').scrollTo(${scroll.x},${scroll.y})`) } catch (error) { failures.push(error) }
  }
  if (failures.length === 1) throw failures[0]
  if (failures.length > 1) throw new AggregateError(failures, 'Wallet toolbar check and restoration failures')
  return facts
}

export function browserFixtureFailureDetails(error) {
  const failures = error instanceof AggregateError ? error.errors : [error]
  return failures.filter(failure => failure instanceof BrowserFixtureError || failure instanceof assert.AssertionError)
    .map(failure => failure.message).join('; ')
}

export async function finishDisplayFixture({ call, evaluate, viewerURL, failures }) {
  const errors = [...failures]
  try { await call('Emulation.clearDeviceMetricsOverride', {}) } catch (error) { errors.push(error) }
  try {
    const navigation = await call('Page.navigate', { url: viewerURL })
    if (navigation?.errorText) throw new BrowserFixtureError('CDP Page.navigate rejected viewer restoration', { cause: navigation })
  } catch (error) { errors.push(error) }
  try {
    const expected = new URL(viewerURL)
    const deadline = Date.now() + 10000
    let restored = false
    while (Date.now() < deadline) {
      const document = await evaluate('({ href: location.href, readyState: document.readyState })')
      const actual = new URL(document.href)
      if (actual.origin === expected.origin && actual.pathname === expected.pathname
          && actual.searchParams.toString() === expected.searchParams.toString() && document.readyState === 'complete') {
        restored = true
        break
      }
      await new Promise(resolve => setTimeout(resolve, 50))
    }
    if (!restored) throw new BrowserFixtureError('Viewer restoration did not reach the expected complete document')
  } catch (error) { errors.push(error) }
  if (errors.length === 1) throw errors[0]
  if (errors.length > 1) throw new AggregateError(errors, 'Display fixture and app restoration failures')
}

export function lostBroadcastReply() {
  return fixtureSubmissionFailure(new Error('Fixture transport reply lost after broadcast'), 'unknown')
}

class FixtureSubmissionError extends Error {
  constructor(cause, submission) {
    const failure = fixtureSubmissionFailure(cause, submission)
    super(failure.message, { cause })
    this.code = failure.code
    this.data = failure.data
  }
}

export function fixtureSubmissionFailure(cause, submission) {
  if (cause instanceof FixtureSubmissionError) return { code: cause.code, message: cause.message, data: cause.data }
  return {
    // -32603 is interpreted as a contract revert by viem. Invalid-input codes
    // can make it submit through a second method. This is a fixture server error.
    code: -32099,
    message: submission === 'not-submitted'
      ? 'The local fixture did not submit the transaction.'
      : 'The local fixture could not confirm transaction submission.',
    data: { submission, diagnostic: viewerErrorMessage(cause, { whitespace: 'collapse' }) },
  }
}

export function fixtureAccount(fixture, name, repeatedByte) {
  const matches = [...fixture.matchAll(new RegExp(`^\\s*${name}: "(0x[0-9a-fA-F]{64})"$`, 'gm'))]
  assert.equal(matches.length, 1, `expected one ${name} fixture declaration`)
  // Assertion operands must not carry key bytes into Node's rendered failure.
  assert(matches[0][1] === `0x${repeatedByte.repeat(32)}`, `${name} must remain an obvious local-only fixture key`)
  return privateKeyToAccount(matches[0][1])
}

export async function submitFixtureTransaction({ wallet, publicClient, transaction, assertChain, shouldContinue }) {
  let submission = 'not-submitted'
  try {
    if (!shouldContinue()) return undefined
    const prepared = await wallet.prepareTransactionRequest(transaction)
    if (!shouldContinue()) return undefined
    await assertChain()
    if (!shouldContinue()) return undefined
    const signed = await wallet.signTransaction(prepared)
    if (!shouldContinue()) return undefined
    await assertChain()
    if (!shouldContinue()) return undefined
    submission = 'unknown'
    return await publicClient.sendRawTransaction({ serializedTransaction: signed })
  } catch (cause) {
    throw new FixtureSubmissionError(cause, submission)
  }
}

export function createCdpCommands({ socket, runDeadline, now }) {
  let nextId = 0
  let cleanupDeadline
  const pending = new Map()
  return {
    call(method, params, session, purpose) {
      if (purpose === 'cleanup') {
        assert(['Runtime.evaluate', 'Target.closeTarget'].includes(method), 'cleanup may only release requests or close an owned target')
        if (cleanupDeadline === undefined) cleanupDeadline = now() + 20000
      }
      const commandDeadline = purpose === 'cleanup' ? cleanupDeadline : runDeadline
      assert(now() < commandDeadline, 'browser write check exceeded command deadline')
      return new Promise((resolve, reject) => {
        const id = ++nextId
        const timer = setTimeout(() => { pending.delete(id); reject(new BrowserFixtureError(`CDP ${method} timed out`)) }, Math.min(10000, commandDeadline - now()))
        pending.set(id, { resolve, reject, timer, method })
        try { socket.send(JSON.stringify({ id, method, params, sessionId: session })) } catch (cause) {
          pending.delete(id)
          clearTimeout(timer)
          reject(new BrowserFixtureError(`CDP ${method} could not be sent`, { cause }))
        }
      })
    },
    receive(message) {
      const waiting = pending.get(message.id)
      if (!waiting) return
      pending.delete(message.id)
      clearTimeout(waiting.timer)
      message.error ? waiting.reject(new BrowserFixtureError(`CDP ${waiting.method} failed`, { cause: message.error })) : waiting.resolve(message.result)
    },
    close() {
      for (const waiting of pending.values()) { clearTimeout(waiting.timer); waiting.reject(new BrowserFixtureError('browser write check closed')) }
      pending.clear()
    },
  }
}
