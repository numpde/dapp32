// Owns local acceptance-runner keys, submission effects and CDP command lifetime.
import assert from 'node:assert/strict'
import { privateKeyToAccount } from 'viem/accounts'

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
        const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP ${method} timed out`)) }, Math.min(10000, commandDeadline - now()))
        pending.set(id, { resolve, reject, timer })
        try { socket.send(JSON.stringify({ id, method, params, sessionId: session })) } catch {
          pending.delete(id)
          clearTimeout(timer)
          reject(new Error(`CDP ${method} could not be sent`))
        }
      })
    },
    receive(message) {
      const waiting = pending.get(message.id)
      if (!waiting) return
      pending.delete(message.id)
      clearTimeout(waiting.timer)
      message.error ? waiting.reject(new Error('CDP command failed')) : waiting.resolve(message.result)
    },
    close() {
      for (const waiting of pending.values()) { clearTimeout(waiting.timer); waiting.reject(new Error('browser write check closed')) }
      pending.clear()
    },
  }
}
