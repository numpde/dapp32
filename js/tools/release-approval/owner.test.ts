import assert from "node:assert/strict"
import { chmodSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { privateKeyToAccount } from "viem/accounts"
import { keccak256 } from "viem"
import { ApprovalOwner, type Audit, type AuditEvent } from "./owner.ts"
import { openAudit } from "./audit.ts"

const account = privateKeyToAccount(`0x${"11".repeat(32)}`)
const other = privateKeyToAccount(`0x${"22".repeat(32)}`)
const referenceDigest = `0x${"ab".repeat(32)}` as const
const destination = `0x${"33".repeat(20)}` as const

async function signed(nonce: number, signer: typeof account) {
  return signer.signTransaction({ type: "eip1559", chainId: 31337, nonce, to: destination,
    value: 1n, gas: 21_000n, maxFeePerGas: 2n, maxPriorityFeePerGas: 1n })
}

function harness(override: Partial<ConstructorParameters<typeof ApprovalOwner>[0]>) {
  let now = 1_000
  const timers: Array<{ due: number; callback: () => void; canceled: boolean }> = []
  const events: AuditEvent[] = []
  const audit: Audit = { append(event) { events.push(event) } }
  const sends: string[] = []
  const owner = new ApprovalOwner({ chainId: 31337, sender: account.address, referenceDigest,
    approvalMs: 180_000, maxWaiters: 32, maxHistory: 128, now: () => now,
    schedule: (callback, delay) => { const timer = { due: now + delay, callback, canceled: false }; timers.push(timer); return () => { timer.canceled = true } },
    audit,
    send: async raw => { sends.push(raw); return keccak256(raw) }, ...override })
  return { owner, events, sends,
    elapseWithoutTimer(ms: number) { now += ms },
    advance(ms: number) { now += ms; for (const timer of timers) if (!timer.canceled && timer.due <= now) { timer.canceled = true; timer.callback() } } }
}

test("only a signed type-2 transaction from the selected chain and sender reaches approval", async () => {
  const h = harness({})
  await assert.rejects(h.owner.submit("0x02"), /signed type-2 transaction/)
  await assert.rejects(h.owner.submit(await signed(0, other)), /sender/)
  assert.equal(h.owner.pending(), null)
  assert.equal(h.sends.length, 0)
})

test("malformed signed bytes never enter ordinary admission diagnostics", async () => {
  const raw = "0x02aa55deadbeef"
  const h = harness({})
  await assert.rejects(h.owner.submit(raw), (error: unknown) => {
    assert(error instanceof Error)
    assert.match(error.message, /Cannot decode signed type-2 transaction/)
    assert.equal(error.message.includes(raw), false)
    assert.equal(error.cause, undefined)
    return true
  })
})

test("duplicates share one approval and one upstream send, including different hex letter case", async () => {
  const h = harness({})
  const raw = await signed(0, account)
  const a = h.owner.submit(raw)
  const b = h.owner.submit(raw.toUpperCase().replace(/^0X/, "0x"))
  await new Promise(resolve => setImmediate(resolve))
  const pending = h.owner.pending()
  assert(pending)
  assert.equal(pending.hash, keccak256(raw))
  assert.equal(pending.sender.toLowerCase(), account.address.toLowerCase())
  await h.owner.decide(pending.challenge, "approve")
  assert.deepEqual(await a, { status: "accepted", hash: pending.hash })
  assert.deepEqual(await b, { status: "accepted", hash: pending.hash })
  assert.equal(h.sends.length, 1)
  assert.deepEqual(await h.owner.submit(raw), { status: "accepted", hash: pending.hash })
  assert.equal(h.sends.length, 1)
})

test("expiry and stale challenge close submissions without forwarding", async () => {
  const h = harness({})
  const raw = await signed(0, account)
  const pendingResult = h.owner.submit(raw)
  await new Promise(resolve => setImmediate(resolve))
  const pending = h.owner.pending()
  assert(pending)
  h.advance(180_001)
  await assert.rejects(h.owner.decide(pending.challenge, "approve"), /stale/)
  assert.deepEqual(await pendingResult, { status: "refused", hash: pending.hash, reason: "approval expired" })
  assert.equal(h.sends.length, 0)
  assert.deepEqual(await h.owner.submit(raw), { status: "refused", hash: pending.hash, reason: "approval expired" })
  await assert.rejects(h.owner.submit(await signed(1, account)), /closed/)
})

test("different simultaneous signed bytes are busy and cannot become a second prompt", async () => {
  const h = harness({})
  const first = h.owner.submit(await signed(0, account))
  await new Promise(resolve => setImmediate(resolve))
  await assert.rejects(h.owner.submit(await signed(1, account)), /awaiting approval/)
  const pending = h.owner.pending()
  assert(pending)
  await h.owner.decide(pending.challenge, "reject")
  assert.equal((await first).status, "refused")
  assert.equal(h.sends.length, 0)
})

test("a second transaction cannot enter while the first upstream call is unresolved", async () => {
  let releaseSend: ((hash: `0x${string}`) => void) | undefined
  const h = harness({ send: raw => new Promise(resolve => { releaseSend = () => resolve(keccak256(raw)) }) })
  const first = h.owner.submit(await signed(0, account))
  await new Promise(resolve => setImmediate(resolve))
  const pending = h.owner.pending()
  assert(pending)
  const approval = h.owner.decide(pending.challenge, "approve")
  await assert.rejects(h.owner.submit(await signed(1, account)), /busy|transmission/)
  assert(releaseSend)
  releaseSend(pending.hash)
  await approval
  assert.equal((await first).status, "accepted")
})

test("closing during transmission preserves its observed outcome and refuses later writes", async () => {
  let finish: (() => void) | undefined
  const h = harness({ send: raw => new Promise(resolve => { finish = () => resolve(keccak256(raw)) }) })
  const raw = await signed(0, account)
  const submitted = h.owner.submit(raw)
  await new Promise(resolve => setImmediate(resolve))
  const pending = h.owner.pending()
  assert(pending)
  const approval = h.owner.decide(pending.challenge, "approve")
  h.owner.close("operator terminal closed")
  assert(finish)
  finish()
  await approval
  assert.deepEqual(await submitted, { status: "accepted", hash: pending.hash })
  await assert.rejects(h.owner.submit(await signed(1, account)), /closed/)
})

test("an identical retry joins an in-flight send after terminal closure", async () => {
  let finish: (() => void) | undefined
  let sends = 0
  const h = harness({ send: raw => new Promise(resolve => { sends++; finish = () => resolve(keccak256(raw)) }) })
  const raw = await signed(0, account)
  const first = h.owner.submit(raw)
  await new Promise(resolve => setImmediate(resolve))
  const pending = h.owner.pending()
  assert(pending)
  const approval = h.owner.decide(pending.challenge, "approve")
  h.owner.close("operator terminal closed")
  const retry = h.owner.submit(raw)
  await assert.rejects(h.owner.submit(await signed(1, account)), /closed|transmission/)
  assert(finish)
  finish()
  await approval
  assert.deepEqual(await first, { status: "accepted", hash: pending.hash })
  assert.deepEqual(await retry, { status: "accepted", hash: pending.hash })
  assert.equal(sends, 1)
})

test("expiry during durable pre-send sync prevents transmission", async () => {
  const events: AuditEvent[] = []
  let duringSync = () => {}
  const h = harness({ audit: { append(event) { events.push(event); if (event.kind === "transmitting") duringSync() } } })
  duringSync = () => h.advance(180_001)
  const waiting = h.owner.submit(await signed(0, account))
  await new Promise(resolve => setImmediate(resolve))
  const pending = h.owner.pending()
  assert(pending)
  await assert.rejects(h.owner.decide(pending.challenge, "approve"), /expired|canceled/)
  assert.deepEqual(await waiting, { status: "refused", hash: pending.hash, reason: "approval expired" })
  assert.equal(h.sends.length, 0)
  assert(events.some(event => event.kind === "transmitting"))
})

test("post-sync clock recheck blocks a send even before the expiry timer runs", async () => {
  let duringSync = () => {}
  const h = harness({ audit: { append(event) { if (event.kind === "transmitting") duringSync() } } })
  duringSync = () => h.elapseWithoutTimer(180_001)
  const waiting = h.owner.submit(await signed(0, account))
  await new Promise(resolve => setImmediate(resolve))
  const pending = h.owner.pending()
  assert(pending)
  await assert.rejects(h.owner.decide(pending.challenge, "approve"), /expired|canceled/)
  assert.deepEqual(await waiting, { status: "refused", hash: pending.hash, reason: "approval expired or canceled" })
  assert.equal(h.sends.length, 0)
})

test("last waiter disconnect during durable pre-send sync prevents transmission", async () => {
  const abort = new AbortController()
  const h = harness({ audit: { append(event) { if (event.kind === "transmitting") abort.abort() } } })
  const waiting = h.owner.submit(await signed(0, account), abort.signal)
  await new Promise(resolve => setImmediate(resolve))
  const pending = h.owner.pending()
  assert(pending)
  await assert.rejects(h.owner.decide(pending.challenge, "approve"), /expired|canceled/)
  await assert.rejects(waiting, /disconnected/)
  assert.equal(h.sends.length, 0)
})

test("one duplicate disconnect does not cancel another live waiter", async () => {
  const h = harness({})
  const raw = await signed(0, account)
  const abort = new AbortController()
  const first = h.owner.submit(raw, abort.signal)
  const second = h.owner.submit(raw)
  await new Promise(resolve => setImmediate(resolve))
  const pending = h.owner.pending()
  assert(pending)
  abort.abort()
  await assert.rejects(first, /disconnected/)
  assert.equal(h.owner.pending()?.challenge, pending.challenge)
  await h.owner.decide(pending.challenge, "approve")
  assert.equal((await second).status, "accepted")
  assert.equal(h.sends.length, 1)
})

test("failed post-send audit sync preserves uncertainty and closes later writes", async () => {
  let sends = 0
  const h = harness({ audit: { append(event) { if (event.kind === "accepted") throw Error("disk failed") } },
    send: async raw => { sends++; return keccak256(raw) } })
  const raw = await signed(0, account)
  const waiting = h.owner.submit(raw)
  await new Promise(resolve => setImmediate(resolve))
  const pending = h.owner.pending()
  assert(pending)
  await h.owner.decide(pending.challenge, "approve")
  assert.deepEqual(await waiting, { status: "uncertain", hash: pending.hash, reason: "cannot persist upstream result" })
  assert.equal(sends, 1)
  assert.deepEqual(await h.owner.submit(raw), { status: "uncertain", hash: pending.hash, reason: "cannot persist upstream result" })
  await assert.rejects(h.owner.submit(await signed(1, account)), /closed/)
})

test("audit sync failure blocks transmission; uncertain response cannot cause replay", async () => {
  const raw = await signed(0, account)
  let sendCalls = 0
  let failBeforeSend = true
  const events: AuditEvent[] = []
  const h = harness({ audit: { append(event) { if (failBeforeSend && event.kind === "transmitting") throw Error("sync failed"); events.push(event) } },
    send: async () => { sendCalls++; throw Error("connection lost") } })
  const pendingResult = h.owner.submit(raw)
  await new Promise(resolve => setImmediate(resolve))
  const pending = h.owner.pending()
  assert(pending)
  await assert.rejects(h.owner.decide(pending.challenge, "approve"), /sync failed/)
  assert.equal(sendCalls, 0)
  assert.equal((await pendingResult).status, "refused")
  await assert.rejects(h.owner.submit(raw), /closed/)
  failBeforeSend = false

  const second = harness({ send: async () => { sendCalls++; throw Error("connection lost") } })
  const waiting = second.owner.submit(raw)
  await new Promise(resolve => setImmediate(resolve))
  const secondPending = second.owner.pending()
  assert(secondPending)
  await second.owner.decide(secondPending.challenge, "approve")
  assert.deepEqual(await waiting, { status: "uncertain", hash: secondPending.hash, reason: "upstream result unknown (Error)" })
  assert.equal(sendCalls, 1)
  assert.deepEqual(await second.owner.submit(raw), { status: "uncertain", hash: secondPending.hash, reason: "upstream result unknown (Error)" })
  assert.equal(sendCalls, 1)
})

test("file audit refuses a used directory and preserves synced events", () => {
  const directory = mkdtempSync(join(tmpdir(), "release-approval-"))
  chmodSync(directory, 0o700)
  try {
    const audit = openAudit(directory)
    audit.append({ kind: "closed", reason: "operator rejected" })
    audit.close()
    assert.match(readFileSync(join(directory, "approval.jsonl"), "utf8"), /operator rejected/)
    assert.throws(() => openAudit(directory), /used|exists|empty/)
  } finally { rmSync(directory, { recursive: true, force: true }) }
})
