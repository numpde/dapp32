// Owns local acceptance-runner keys, submission effects and CDP command lifetime.
import assert from 'node:assert/strict'
import { privateKeyToAccount } from 'viem/accounts'

export class BrowserFixtureError extends Error {}

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
  // Invalid input invites the wallet SDK to try a second submission method.
  return { code: -32603, message: 'Fixture transport reply lost after broadcast' }
}

export function fixtureAccount(fixture, name, repeatedByte) {
  const matches = [...fixture.matchAll(new RegExp(`^\\s*${name}: "(0x[0-9a-fA-F]{64})"$`, 'gm'))]
  assert.equal(matches.length, 1, `expected one ${name} fixture declaration`)
  // Assertion operands must not carry key bytes into Node's rendered failure.
  assert(matches[0][1] === `0x${repeatedByte.repeat(32)}`, `${name} must remain an obvious local-only fixture key`)
  return privateKeyToAccount(matches[0][1])
}

export async function submitFixtureTransaction({ wallet, publicClient, transaction, assertChain, shouldContinue }) {
  if (!shouldContinue()) return undefined
  const prepared = await wallet.prepareTransactionRequest(transaction)
  if (!shouldContinue()) return undefined
  await assertChain()
  if (!shouldContinue()) return undefined
  const signed = await wallet.signTransaction(prepared)
  if (!shouldContinue()) return undefined
  await assertChain()
  if (!shouldContinue()) return undefined
  return publicClient.sendRawTransaction({ serializedTransaction: signed })
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
