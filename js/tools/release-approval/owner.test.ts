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
    audit, inspect: async () => {}, accepted: () => {}, notAccepted: () => {},
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

test("concurrent exact duplicates share admission before any audit or prompt; different bytes cannot race", async () => {
  let finishInspection: (() => void) | undefined
  let inspections = 0
  let accepted = 0
  const h = harness({ inspect: async () => { inspections++; await new Promise<void>(resolve => { finishInspection = resolve }) },
    accepted: () => { accepted++ } })
  const raw = await signed(0, account)
  const first = h.owner.submit(raw)
  const duplicate = h.owner.submit(raw)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(h.owner.pending(), null)
  assert.equal(h.events.length, 0)
  assert.equal(inspections, 1)
  await assert.rejects(h.owner.submit(await signed(1, account)), /candidate|inspection|busy/i)
  assert(finishInspection)
  finishInspection()
  await new Promise(resolve => setImmediate(resolve))
  const pending = h.owner.pending()
  assert(pending)
  assert.equal(h.events.filter(event => event.kind === "pending").length, 1)
  await h.owner.decide(pending.challenge, "approve")
  assert.equal((await first).status, "accepted")
  assert.equal((await duplicate).status, "accepted")
  assert.equal(accepted, 1)
  assert.equal((await h.owner.submit(raw)).status, "accepted")
  assert.equal(inspections, 1)
})

test("a stalled inspection admits only the configured number of waiters", async () => {
  let finishInspection: (() => void) | undefined
  const h = harness({ maxWaiters: 2,
    inspect: async () => { await new Promise<void>(resolve => { finishInspection = resolve }) } })
  const raw = await signed(0, account)
  const first = h.owner.submit(raw)
  const second = h.owner.submit(raw)
  await new Promise(resolve => setImmediate(resolve))
  let rejectedBeforeRelease = false
  const third = h.owner.submit(raw).then(
    () => null,
    error => { rejectedBeforeRelease = true; return error as Error },
  )
  await new Promise(resolve => setImmediate(resolve))
  const wasBounded = rejectedBeforeRelease
  assert.equal(h.owner.pending(), null)
  assert(finishInspection)
  finishInspection()
  await new Promise(resolve => setImmediate(resolve))
  const pending = h.owner.pending()
  assert(pending)
  await h.owner.decide(pending.challenge, "approve")
  assert.equal((await first).status, "accepted")
  assert.equal((await second).status, "accepted")
  const thirdError = await third
  assert.equal(wasBounded, true)
  assert(thirdError instanceof Error)
  assert.match(thirdError.message, /too many.*waiters/i)
})

test("closing during inspection releases the reservation and never publishes a prompt", async () => {
  let finishInspection: (() => void) | undefined
  const cleared: string[] = []
  const h = harness({ inspect: async () => { await new Promise<void>(resolve => { finishInspection = resolve }) },
    notAccepted: hash => { cleared.push(hash) } })
  const raw = await signed(0, account)
  const waiting = h.owner.submit(raw)
  await new Promise(resolve => setImmediate(resolve))
  h.owner.close("operator terminal closed")
  assert(finishInspection)
  finishInspection()
  await assert.rejects(waiting, /closed|canceled/)
  assert.equal(h.owner.pending(), null)
  assert.deepEqual(cleared, [keccak256(raw)])
})

test("closing after inspection but before the pending audit releases admission without an orphan prompt", async () => {
  let owner: ApprovalOwner
  let clockReads = 0
  const released: string[] = []
  const h = harness({ now: () => {
    clockReads++
    owner.close("operator terminal closed")
    return 1_000
  }, notAccepted: hash => { released.push(hash) } })
  owner = h.owner
  const raw = await signed(0, account)
  await assert.rejects(owner.submit(raw), /closed/)
  assert.equal(clockReads, 1)
  assert.equal(owner.pending(), null)
  assert.equal(h.events.some(event => event.kind === "pending"), false)
  assert.deepEqual(released, [keccak256(raw)])
})

test("a different transaction submitted during pending installation cannot replace the admitted candidate", async () => {
  const firstRaw = await signed(0, account)
  const secondRaw = await signed(1, account)
  let owner: ApprovalOwner
  let competing: Promise<Error | null> | null = null
  let inspections = 0
  const h = harness({ now: () => {
    if (competing === null) {
      competing = owner.submit(secondRaw).then(
        () => null,
        error => error instanceof Error ? error : new Error(String(error)),
      )
    }
    return 1_000
  }, inspect: async () => { inspections++ } })
  owner = h.owner
  const first = owner.submit(firstRaw)
  await new Promise(resolve => setImmediate(resolve))
  function competingResult(): Promise<Error | null> {
    if (competing === null) throw new Error("The competing submission was not started")
    return competing
  }
  const rejected = await competingResult()
  assert(rejected instanceof Error)
  assert.match(rejected.message, /another transaction|candidate|inspection/i)
  const pending = owner.pending()
  assert(pending)
  assert.equal(pending.hash, keccak256(firstRaw))
  assert.equal(h.events.filter(event => event.kind === "pending").length, 1)
  assert.equal(inspections, 1)
  await owner.decide(pending.challenge, "reject")
  assert.equal((await first).status, "refused")
  assert.equal(h.sends.length, 0)
})

test("reservation cleanup failure is visible with refusal and uncertainty", async () => {
  const raw = await signed(0, account)
  const refusal = harness({ notAccepted: () => { throw Error("cleanup failed") } })
  const refused = refusal.owner.submit(raw)
  await new Promise(resolve => setImmediate(resolve))
  const pending = refusal.owner.pending()
  assert(pending)
  await refusal.owner.decide(pending.challenge, "reject")
  const refusedResult = await refused
  assert.equal(refusedResult.status, "refused")
  assert.match(refusedResult.reason, /operator rejected.*reservation cleanup failed/i)
  await assert.rejects(refusal.owner.submit(await signed(1, account)), /reservation cleanup failed/i)

  const uncertainty = harness({ send: async () => { throw Error("lost reply") },
    notAccepted: () => { throw Error("cleanup failed") } })
  const uncertain = uncertainty.owner.submit(raw)
  await new Promise(resolve => setImmediate(resolve))
  const secondPending = uncertainty.owner.pending()
  assert(secondPending)
  await uncertainty.owner.decide(secondPending.challenge, "approve")
  const result = await uncertain
  assert.equal(result.status, "uncertain")
  assert.match(result.reason, /upstream result unknown.*reservation cleanup failed/i)
  await assert.rejects(uncertainty.owner.submit(await signed(1, account)), /reservation cleanup failed/i)
})

test("aborting the sole admission waiter leaves no prompt or reserved verifier candidate", async () => {
  let finishInspection: (() => void) | undefined
  const cleared: string[] = []
  const abort = new AbortController()
  const h = harness({ inspect: async () => { await new Promise<void>(resolve => { finishInspection = resolve }) },
    notAccepted: hash => { cleared.push(hash) } })
  const raw = await signed(0, account)
  const waiting = h.owner.submit(raw, abort.signal)
  await new Promise(resolve => setImmediate(resolve))
  abort.abort()
  await assert.rejects(waiting, /disconnected/)
  assert(finishInspection)
  finishInspection()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(h.owner.pending(), null)
  assert.equal(h.sends.length, 0)
  assert.deepEqual(cleared, [keccak256(raw)])
  await assert.rejects(h.owner.submit(raw), /closed/)
})

test("accepted continuation runs once after durable acceptance and preserves acceptance if it fails", async () => {
  let calls = 0
  const events: AuditEvent[] = []
  const h = harness({ audit: { append(event) { events.push(event) } },
    accepted: () => { calls++; assert(events.some(event => event.kind === "accepted")); throw Error("verifier continuation failed") } })
  const raw = await signed(0, account)
  const waiting = h.owner.submit(raw)
  await new Promise(resolve => setImmediate(resolve))
  const pending = h.owner.pending()
  assert(pending)
  await h.owner.decide(pending.challenge, "approve")
  assert.deepEqual(await waiting, { status: "accepted", hash: pending.hash, continuationFailure: "Error" })
  assert.deepEqual(await h.owner.submit(raw), { status: "accepted", hash: pending.hash, continuationFailure: "Error" })
  assert.equal(calls, 1)
  assert.equal(h.sends.length, 1)
  await assert.rejects(h.owner.submit(await signed(1, account)), /closed/)
})

test("refusal and uncertain send each release verifier reservation once", async () => {
  const refused: string[] = []
  const h = harness({ notAccepted: hash => { refused.push(hash) } })
  const raw = await signed(0, account)
  const waiting = h.owner.submit(raw)
  await new Promise(resolve => setImmediate(resolve))
  const pending = h.owner.pending()
  assert(pending)
  await h.owner.decide(pending.challenge, "reject")
  assert.equal((await waiting).status, "refused")
  await h.owner.submit(raw)
  assert.deepEqual(refused, [pending.hash])

  const uncertain: string[] = []
  const failed = harness({ send: async () => { throw Error("lost reply") }, notAccepted: hash => { uncertain.push(hash) } })
  const failedWaiting = failed.owner.submit(raw)
  await new Promise(resolve => setImmediate(resolve))
  const failedPending = failed.owner.pending()
  assert(failedPending)
  await failed.owner.decide(failedPending.challenge, "approve")
  assert.equal((await failedWaiting).status, "uncertain")
  await failed.owner.submit(raw)
  assert.deepEqual(uncertain, [failedPending.hash])
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
