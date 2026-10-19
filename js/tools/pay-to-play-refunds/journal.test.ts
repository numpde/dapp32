import assert from "node:assert/strict"
import { chmodSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { RefundWorkerError } from "./core.ts"
import { openJournal, readProtectedFile, type Identity, type Pending } from "./journal.ts"
const identity: Identity = { chainId: "31337", payment: `0x${"11".repeat(20)}`, codeHash: `0x${"ab".repeat(32)}`, channelId: "1" }
const transaction: Pending = { customer: `0x${"22".repeat(20)}`, hash: `0x${"cd".repeat(32)}`, nonce: 3 }
function directory(): string { const dir = mkdtempSync(join(tmpdir(), "refund-journal-")); chmodSync(dir, 0o700); return dir }

test("pending hash survives restart and prevents another signature until a matching receipt", () => {
  const dir = directory()
  try {
    const first = openJournal(dir, identity)
    first.recordPending(transaction)
    assert.throws(() => first.recordPending(transaction), /pending transaction/)
    assert.throws(() => openJournal(dir, identity), /EEXIST/)
    first.close()
    const second = openJournal(dir, identity)
    assert.deepEqual(second.pending, transaction)
    assert.throws(() => second.recordReceipt(identity.codeHash, "confirmed", 9n, identity.codeHash), /does not match/)
    second.recordReceipt(transaction.hash, "confirmed", 9n, identity.codeHash)
    assert.equal(second.pending, null)
    second.close()
    const saved = JSON.parse(readFileSync(join(dir, "refunds.json"), "utf8"))
    assert.equal(saved.lastReceipt.hash, transaction.hash)
    assert.equal(saved.lastReceipt.status, "confirmed")
    assert.equal(saved.lastReceipt.blockNumber, "9")
    assert.equal(saved.pending, null)
    const third = openJournal(dir, identity)
    third.close()
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test("deployment identity mismatch and malformed journals fail without losing pending state", () => {
  const dir = directory()
  try {
    const first = openJournal(dir, identity)
    first.recordPending(transaction)
    first.close()
    assert.throws(() => openJournal(dir, { ...identity, channelId: "2" }), /different deployment/)
    const second = openJournal(dir, identity)
    assert.deepEqual(second.pending, transaction)
    second.close()
    writeFileSync(join(dir, "refunds.json"), "{}", { mode: 0o600 })
    assert.throws(() => openJournal(dir, identity))
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test("protected file reader rejects permissive files, symlinks and oversized input", () => {
  const dir = directory()
  try {
    const file = join(dir, "input")
    writeFileSync(file, "fixture", { mode: 0o600 })
    assert.equal(readProtectedFile(file, 16_384), "fixture")
    assert.throws(() => readProtectedFile(file, 3))
    symlinkSync(file, join(dir, "link"))
    assert.throws(() => readProtectedFile(join(dir, "link"), 16_384))
    chmodSync(file, 0o644)
    assert.throws(() => readProtectedFile(file, 16_384), /owner-only/)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test("protected file reader rejects malformed UTF-8 byte sequences", () => {
  const dir = directory()
  try {
    const file = join(dir, "input")
    const malformed = [
      ["invalid byte", Buffer.from([0xff])],
      ["truncated sequence", Buffer.from([0xe2, 0x82])],
      ["overlong sequence", Buffer.from([0xc0, 0xaf])],
      ["surrogate encoding", Buffer.from([0xed, 0xa0, 0x80])],
    ] as const
    for (const [kind, bytes] of malformed) {
      writeFileSync(file, bytes, { mode: 0o600 })
      assert.throws(
        () => readProtectedFile(file, 16_384),
        (error: unknown) => {
          assert(error instanceof RefundWorkerError)
          assert.equal(error.message, "Protected file must contain valid UTF-8")
          assert(error.cause instanceof TypeError)
          return true
        },
        kind,
      )
    }
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test("protected file reader preserves valid Unicode, BOM and line endings", () => {
  const dir = directory()
  try {
    const file = join(dir, "input")
    const text = "\uFEFFcafé �\r\n"
    writeFileSync(file, Buffer.from(text, "utf8"), { mode: 0o600 })
    assert.equal(readProtectedFile(file, 16_384), text)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
