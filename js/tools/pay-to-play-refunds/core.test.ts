import assert from "node:assert/strict"
import test from "node:test"
import { discoverCustomers, isRefundDue, runRefundBatch, type Address, type Position, type SendResult } from "./core.ts"

const alice = `0x${"11".repeat(20)}` as Address
const bob = `0x${"22".repeat(20)}` as Address
const carol = `0x${"33".repeat(20)}` as Address
const hash = `0x${"ab".repeat(32)}` as const
const due = (): Position => ({ balance: 50n, scheduledRefundAt: 100n, requestedAmount: 0n, refundAt: 100n, refundRecipient: alice, phase: 2 })
const quiet = () => {}

test("discovery covers inclusive boundaries, deduplicates and sorts incoming positions", async () => {
  const calls: [bigint, bigint][] = []
  const found = await discoverCustomers(async (from, to) => { calls.push([from, to]); return [bob, alice, bob] }, {
    fromBlock: 10n, toBlock: 14n, blockChunk: 2, maxCustomers: 10,
  })
  assert.deepEqual(calls, [[10n, 11n], [12n, 13n], [14n, 14n]])
  assert.deepEqual(found, [alice, bob])
})

test("discovery fails closed on limits and page failures, never silently truncates", async () => {
  const options = { fromBlock: 0n, toBlock: 2n, blockChunk: 1, maxCustomers: 1 }
  await assert.rejects(() => discoverCustomers(async () => [alice, bob], options), /Customer limit/)
  await assert.rejects(() => discoverCustomers(async () => { throw new Error("RPC failed") }, options))
  await assert.rejects(() => discoverCustomers(async () => [], { ...options, toBlock: 100_000n }), /100000/)
  await assert.rejects(() => discoverCustomers(async () => [], { ...options, blockChunk: 0 }), /blockChunk/)
  await assert.rejects(() => discoverCustomers(async () => Array(10001).fill(alice), options), /Too many events/)
})

test("dry-run never sends and a clean retired position is not work", async () => {
  const events: Record<string, string | number | boolean>[] = []
  const summary = await runRefundBatch([alice, alice, bob], {
    readPosition: async customer => customer === alice ? due() : { ...due(), balance: 0n, scheduledRefundAt: 0n },
    sendRefund: async () => { throw new Error("must not send") },
  }, { execute: false, maxTransactions: 2, report: entry => { events.push(entry) } })
  assert.equal(summary.inspected, 2)
  assert.equal(summary.due, 1)
  assert.equal(summary.submitted, 0)
  assert(events.some(entry => entry.event === "due" && entry.recipient === alice))
})

test("an empty expired cycle still needs a zero refund before reuse", () => {
  assert(isRefundDue({ ...due(), balance: 0n }))
  assert(!isRefundDue({ ...due(), phase: 1 }))
  assert(!isRefundDue({ ...due(), refundAt: 0n }))
  assert(!isRefundDue({ ...due(), balance: 0n, scheduledRefundAt: 0n }))
  assert(isRefundDue({ ...due(), balance: 0n, scheduledRefundAt: 0n, requestedAmount: 1n }))
})

test("recipient simulation failure does not consume the transaction grant or block another customer", async () => {
  const sent: Address[] = []
  const summary = await runRefundBatch([alice, bob], {
    readPosition: async () => due(),
    sendRefund: async customer => {
      sent.push(customer)
      return customer === alice ? { status: "simulation_failed" } : { status: "confirmed", hash }
    },
  }, { execute: true, maxTransactions: 1, report: quiet })
  assert.deepEqual(sent, [alice, bob])
  assert.equal(summary.failed, 1)
  assert.equal(summary.confirmed, 1)
  assert.equal(summary.submitted, 1)
})

test("confirmed reverts consume the grant; remaining customers are explicitly deferred", async () => {
  const summary = await runRefundBatch([alice, bob, carol], {
    readPosition: async () => due(), sendRefund: async (): Promise<SendResult> => ({ status: "reverted", hash }),
  }, { execute: true, maxTransactions: 1, report: quiet })
  assert.equal(summary.failed, 1)
  assert.equal(summary.submitted, 1)
  assert.equal(summary.deferred, 2)
})

test("uncertain broadcast stops the batch; unexpected adapter failures also stop", async () => {
  let reads = 0
  const summary = await runRefundBatch([alice, bob], {
    readPosition: async () => { reads++; return due() }, sendRefund: async () => ({ status: "pending", hash }),
  }, { execute: true, maxTransactions: 5, report: quiet })
  assert.equal(reads, 1)
  assert.equal(summary.pending, true)
  await assert.rejects(() => runRefundBatch([alice, bob], {
    readPosition: async () => due(), sendRefund: async () => { throw new Error("journal unavailable") },
  }, { execute: true, maxTransactions: 5, report: quiet }))
})

test("reruns use fresh chain state: skip paid, retry failed, and recognize later expired cycles", async () => {
  let position = due()
  let sends = 0
  const adapter = {
    readPosition: async () => position,
    sendRefund: async (): Promise<SendResult> => {
      sends++
      if (sends === 1) return { status: "simulation_failed" }
      position = { ...position, balance: 0n, scheduledRefundAt: 0n, refundAt: 0n, phase: 0 }
      return { status: "confirmed", hash }
    },
  }
  const options = { execute: true, maxTransactions: 5, report: quiet }
  assert.equal((await runRefundBatch([alice], adapter, options)).failed, 1)
  assert.equal((await runRefundBatch([alice], adapter, options)).confirmed, 1)
  assert.equal((await runRefundBatch([alice], adapter, options)).submitted, 0)
  position = { ...due(), refundAt: 1000n, scheduledRefundAt: 1000n }
  assert.equal((await runRefundBatch([alice], adapter, options)).confirmed, 1)
  assert.equal(sends, 3)
})
