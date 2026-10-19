import { constants, closeSync, existsSync, fsyncSync, fstatSync, lstatSync, mkdirSync, openSync, readSync, realpathSync, renameSync, rmdirSync, unlinkSync, writeFileSync } from "node:fs"
import { randomUUID } from "node:crypto"
import { isAbsolute, join, resolve } from "node:path"
import type { Address, Hex } from "./core.ts"
import { RefundWorkerError } from "./core.ts"

export interface Identity { chainId: string; payment: Address; codeHash: Hex; channelId: string }
export interface Pending { customer: Address; hash: Hex; nonce: number }
export interface JournalState {
  version: 1
  identity: Identity
  pending: Pending | null
  lastReceipt: ({ status: "confirmed" | "reverted"; blockNumber: string; blockHash: Hex } & Pending) | null
}

// File-backed credentials never enter arguments, environment values or logs.
export function readProtectedFile(path: string, maxBytes: number): string {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
  try {
    const stat = fstatSync(fd)
    if (!stat.isFile() || stat.size > maxBytes || (stat.mode & 0o077) !== 0 || stat.uid !== process.getuid?.()) {
      throw new RefundWorkerError("Expected a bounded, owner-only regular file")
    }
    const bytes = Buffer.alloc(maxBytes + 1)
    let length = 0
    while (length < bytes.length) {
      const count = readSync(fd, bytes, length, bytes.length - length, null)
      if (count === 0) break
      length += count
    }
    if (length > maxBytes) throw new RefundWorkerError("File grew past its size limit")
    try {
      return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes.subarray(0, length))
    } catch (cause) {
      throw new RefundWorkerError("Protected file must contain valid UTF-8", { cause })
    }
  } finally { closeSync(fd) }
}

function object(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new RefundWorkerError("Invalid journal object")
  return value as Record<string, unknown>
}
function pending(value: unknown): Pending {
  const p = object(value)
  if (typeof p.customer !== "string" || !/^0x[0-9a-f]{40}$/.test(p.customer)
    || typeof p.hash !== "string" || !/^0x[0-9a-f]{64}$/.test(p.hash)
    || typeof p.nonce !== "number" || !Number.isSafeInteger(p.nonce) || p.nonce < 0) throw new RefundWorkerError("Invalid pending transaction")
  return { customer: p.customer as Address, hash: p.hash as Hex, nonce: p.nonce }
}

export function openJournal(directory: string, identity: Identity) {
  if (!isAbsolute(directory) || realpathSync(directory) !== resolve(directory)) throw new RefundWorkerError("State directory must be an absolute non-symlink path")
  const stat = lstatSync(directory)
  if (!stat.isDirectory() || (stat.mode & 0o077) !== 0 || stat.uid !== process.getuid?.()) throw new RefundWorkerError("State directory must be owner-only")
  const lock = join(directory, "refunds.lock")
  // Never remove another process's lock or guess whether its RPC call finished.
  mkdirSync(lock, { mode: 0o700 })
  const filename = join(directory, "refunds.json")
  let state: JournalState = { version: 1, identity, pending: null, lastReceipt: null }
  let closed = false
  try {
    if (existsSync(filename)) {
      const parsed = object(JSON.parse(readProtectedFile(filename, 16_384)))
      const storedIdentity = object(parsed.identity)
      if (parsed.version !== 1 || Object.keys(storedIdentity).length !== 4
        || Object.entries(identity).some(([key, value]) => storedIdentity[key] !== value)) throw new RefundWorkerError("Journal belongs to a different deployment/channel")
      state.pending = parsed.pending === null ? null : pending(parsed.pending)
      if (parsed.lastReceipt !== null) {
        const receipt = object(parsed.lastReceipt)
        if ((receipt.status !== "confirmed" && receipt.status !== "reverted") || typeof receipt.blockNumber !== "string"
          || !/^(0|[1-9][0-9]*)$/.test(receipt.blockNumber) || typeof receipt.blockHash !== "string" || !/^0x[0-9a-f]{64}$/.test(receipt.blockHash)) throw new RefundWorkerError("Invalid last receipt")
        state.lastReceipt = { ...pending(receipt), status: receipt.status, blockNumber: receipt.blockNumber, blockHash: receipt.blockHash as Hex }
      }
    }
  } catch (error) { rmdirSync(lock); throw error }

  function save(next: JournalState) {
    if (closed) throw new RefundWorkerError("Journal closed")
    const temporary = join(directory, `refunds-${randomUUID()}.tmp`)
    const fd = openSync(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600)
    try {
      try { writeFileSync(fd, JSON.stringify(next) + "\n"); fsyncSync(fd) }
      finally { closeSync(fd) }
      renameSync(temporary, filename)
      const dir = openSync(directory, constants.O_RDONLY | constants.O_DIRECTORY)
      try { fsyncSync(dir) } finally { closeSync(dir) }
      state = next
    } finally { if (existsSync(temporary)) unlinkSync(temporary) }
  }
  return {
    get pending(): Pending | null { return state.pending === null ? null : { ...state.pending } },
    recordPending(transaction: Pending) {
      if (state.pending !== null) throw new RefundWorkerError("Resolve the pending transaction before signing another")
      save({ ...state, pending: pending(transaction) })
    },
    recordReceipt(hash: Hex, status: "confirmed" | "reverted", blockNumber: bigint, blockHash: Hex) {
      if (state.pending === null || state.pending.hash !== hash) throw new RefundWorkerError("Receipt does not match pending transaction")
      save({ ...state, pending: null, lastReceipt: { ...state.pending, status, blockNumber: blockNumber.toString(), blockHash } })
    },
    close() { if (!closed) { closed = true; rmdirSync(lock) } },
  }
}
