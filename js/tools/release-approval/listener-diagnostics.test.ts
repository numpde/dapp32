import assert from "node:assert/strict"
import { once } from "node:events"
import { existsSync, mkdtempSync, rmSync } from "node:fs"
import { connect, type Socket } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test, type TestContext } from "node:test"
import type { Hex } from "viem"
import { startRpcListener, type FixedBackend, type ListenerOptions, type RpcResponse, type RpcTraceOutput } from "./listener.ts"
import type { SubmissionResult } from "./owner.ts"

const nextTurn = () => new Promise<void>(resolve => setImmediate(resolve))
const LIMITS = { maxConnections: 4, maxConnectionAttempts: 256, connectionWindowMs: 1000 }

// Node's test timeout does not cancel a Promise already awaiting a socket
// event or server-close callback. Keep explicit, referenced deadlines around
// those operations so a broken fixture fails with its exact blocked boundary.
async function bounded<T>(operation: string, pending: Promise<T>, milliseconds: number): Promise<T> {
  let timer: NodeJS.Timeout | null = null
  try {
    return await Promise.race([
      pending,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Timed out waiting for ${operation}`)), milliseconds)
      }),
    ])
  } finally {
    if (timer !== null) clearTimeout(timer)
  }
}

async function until(predicate: () => boolean) {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (predicate()) return
    await new Promise(resolve => setTimeout(resolve, 5))
  }
  assert.ok(predicate(), "expected socket event did not arrive")
}

function traceCapture(t: TestContext) {
  const previous = process.env.RELEASE_APPROVAL_TRACE_RPC
  process.env.RELEASE_APPROVAL_TRACE_RPC = "1"
  t.after(() => {
    if (previous === undefined) delete process.env.RELEASE_APPROVAL_TRACE_RPC
    else process.env.RELEASE_APPROVAL_TRACE_RPC = previous
  })
  const lines: string[] = []
  const output = {
    destroyed: false,
    writableNeedDrain: false,
    write(line: string) { lines.push(line); return true },
  }
  return { lines, output }
}

async function fixture(
  limits: Pick<ListenerOptions, "maxConnections" | "maxConnectionAttempts" | "connectionWindowMs">,
  traceOutput: RpcTraceOutput,
) {
  const directory = mkdtempSync(join(tmpdir(), "approval-diagnostics-"))
  const socketPath = join(directory, "rpc.sock")
  const fatal: string[] = []
  const counts = { reads: 0, submissions: 0, aborted: 0, sent: 0 }
  const backend: FixedBackend = {
    maxResponseBytes: 4096,
    async read(rpc) { counts.reads++; return { jsonrpc: "2.0", id: rpc.id, result: "0x2a" } },
    async send() { counts.sent++; return ("0x" + "a".repeat(64)) as Hex },
  }
  const owner = {
    submit(_raw: string, signal?: AbortSignal): Promise<SubmissionResult> {
      counts.submissions++
      return new Promise((_resolve, reject) => {
        signal?.addEventListener("abort", () => {
          counts.aborted++
          reject(new Error("waiter disconnected"))
        }, { once: true })
      })
    },
  }
  const listener = await startRpcListener({
    socketPath, owner, backend, maxInFlight: 4,
    maxMessageBytes: 4096, ...limits, traceOutput, onFatal: reason => { fatal.push(reason) },
  })
  return {
    socketPath, listener, counts, fatal,
    async close() {
      try {
        await bounded("approval listener shutdown", listener.close(), 3_000)
      } finally {
        rmSync(directory, { recursive: true, force: true })
      }
    },
  }
}

async function client(path: string): Promise<Socket> {
  const socket = connect(path)
  socket.on("error", () => {})
  try {
    await bounded("IPC client connection", once(socket, "connect"), 2_000)
    return socket
  } catch (error) {
    socket.destroy()
    throw error
  }
}

async function emptyPeer(path: string) {
  const socket = connect(path)
  const closed = new Promise<void>(resolve => socket.once("close", () => resolve()))
  // Test only admission of an empty connection, not peer half-close behavior.
  // Destroy explicitly after connect so the test cannot await a remote FIN
  // while holding an unread socket open indefinitely.
  socket.on("error", () => {})
  socket.once("connect", () => socket.destroy())
  try {
    await bounded("empty IPC peer closure", closed, 2_000)
  } finally {
    socket.destroy()
  }
}

function exchange(socket: Socket, wire: string, expected: number): Promise<RpcResponse[]> {
  return new Promise((resolve, reject) => {
    let bytes = ""
    const answers: RpcResponse[] = []
    const timer = setTimeout(() => {
      clean()
      reject(new Error(`Timed out waiting for ${expected} IPC RPC responses`))
    }, 3_000)
    const clean = () => {
      clearTimeout(timer)
      socket.off("data", onData)
      socket.off("close", onClose)
    }
    const onClose = () => { clean(); reject(new Error("socket closed before response")) }
    const onData = (chunk: Buffer) => {
      bytes += chunk.toString("utf8")
      try {
        for (;;) {
          const end = bytes.indexOf("\n")
          if (end < 0) return
          answers.push(JSON.parse(bytes.slice(0, end)) as RpcResponse)
          bytes = bytes.slice(end + 1)
          if (answers.length === expected) { clean(); resolve(answers); return }
        }
      } catch (error) { clean(); reject(error) }
    }
    socket.on("data", onData)
    socket.on("close", onClose)
    try { socket.write(wire) }
    catch (error) { clean(); reject(error) }
  })
}

function rpc(id: number | string, method: string, params: unknown[]) {
  return JSON.stringify({ jsonrpc: "2.0", id, method, params })
}

test("empty connections are counted without generating one log per open and close", { timeout: 5000 }, async t => {
  const { lines, output } = traceCapture(t)
  const f = await fixture(LIMITS, output)
  try {
    for (let i = 0; i < 30; i++) await emptyPeer(f.socketPath)
    await until(() => f.listener.diagnostics().closed === 30)
    const stats = f.listener.diagnostics()
    assert.equal(stats.attempts, 30)
    assert.equal(stats.empty, 30)
    assert.equal(stats.no_requests, 30)
    assert.equal(stats.requests, 0)
    assert.equal(stats.rejected, 0)
    assert.equal(stats.failure, null)
    await bounded("listener close with empty peers", f.listener.close(), 3_000)
    const output = lines.join("")
    assert.doesNotMatch(output, /connection=\d+ (?:opened|closed)/)
    assert.match(output, /stats .*empty=30/)
    assert.ok(Buffer.byteLength(output) < 2048)
  } finally { await f.close() }
})

test("connection capacity refusals are visible and do not evict a working peer", { timeout: 5000 }, async t => {
  const { lines, output } = traceCapture(t)
  const f = await fixture({ ...LIMITS, maxConnections: 1 }, output)
  let active: Socket | undefined
  try {
    active = await client(f.socketPath)
    await until(() => f.listener.diagnostics().active === 1)
    await emptyPeer(f.socketPath)
    const [reply] = await exchange(active, rpc(1, "eth_chainId", []), 1)
    assert.equal(reply?.result, "0x2a")
    assert.equal(f.listener.diagnostics().rejected, 1)
    assert.equal(f.listener.diagnostics().peak, 1)
    assert.equal(f.listener.diagnostics().failure, null)
    assert.match(lines.join(""), /rejected=connection-limit active=1 limit=1/)
  } finally { active?.destroy(); await f.close() }
})

test("connection storm stops admission once and cancels a held transaction without forwarding it", { timeout: 5000 }, async t => {
  const { output } = traceCapture(t)
  const f = await fixture({ ...LIMITS, maxConnectionAttempts: 3, connectionWindowMs: 60000 }, output)
  let held: Socket | undefined
  try {
    held = await client(f.socketPath)
    held.write(rpc(1, "eth_sendRawTransaction", ["0x02aa"]))
    await until(() => f.counts.submissions === 1)
    for (let i = 0; i < 3; i++) await emptyPeer(f.socketPath)
    await until(() => f.fatal.length === 1 && f.counts.aborted === 1)
    await bounded("first listener close after storm", f.listener.close(), 3_000)
    await bounded("repeat listener close after storm", f.listener.close(), 3_000)
    assert.equal(f.fatal.length, 1)
    const reason = f.fatal[0]
    assert.ok(reason !== undefined)
    assert.match(reason, /IPC connection storm/)
    assert.equal(f.listener.diagnostics().attempts, 4)
    assert.equal(f.listener.diagnostics().active, 0)
    assert.equal(f.counts.sent, 0)
  } finally { held?.destroy(); await f.close() }
})

test("unknown methods and malformed frames are diagnosed without caller text", { timeout: 5000 }, async t => {
  const { lines, output } = traceCapture(t)
  const f = await fixture(LIMITS, output)
  let socket: Socket | undefined
  try {
    socket = await client(f.socketPath)
    const [reply] = await exchange(socket, rpc("secret-id", "secretCredentialMethod", ["secret-parameter"]), 1)
    assert.equal(reply?.error?.code, -32601)
    const [invalid] = await exchange(socket, '{"secret-frame":,}', 1)
    assert.equal(invalid?.error?.code, -32700)
    await until(() => f.listener.diagnostics().closed === 1)
    assert.equal(f.listener.diagnostics().parse_errors, 1)
    assert.equal(f.listener.diagnostics().empty, 0)
    assert.equal(f.counts.reads, 0)
    const output = lines.join("")
    assert.match(output, /method=unlisted/)
    assert.match(output, /rejected=invalid-or-oversized-frame/)
    assert.match(output, /closed reason=invalid-or-oversized-frame received_bytes=\d+/)
    for (const secret of ["secret-id", "secretCredentialMethod", "secret-parameter", "secret-frame"]) {
      assert.equal(output.includes(secret), false)
    }
  } finally { socket?.destroy(); await f.close() }
})

test("trace rate limiting does not change RPC responses", { timeout: 5000 }, async t => {
  const { lines, output } = traceCapture(t)
  // A fixed diagnostic clock makes the per-window budget deterministic.
  t.mock.method(performance, "now", () => 1000)
  const f = await fixture(LIMITS, output)
  let socket: Socket | undefined
  try {
    socket = await client(f.socketPath)
    const wire = Array.from({ length: 100 }, (_, i) => rpc(i, "unsupported", [])).join("")
    const answers = await exchange(socket, wire, 100)
    await nextTurn()
    assert.ok(answers.every(answer => answer.error?.code === -32601))
    assert.equal(f.listener.diagnostics().requests, 100)
    assert.equal(f.listener.diagnostics().responses, 100)
    assert.ok(f.listener.diagnostics().suppressed > 0)
    assert.ok(lines.length <= 129) // one limits line plus at most 128 details
    assert.equal(f.listener.diagnostics().failure, null)
  } finally { socket?.destroy(); await f.close() }
})

test("diagnostic backpressure drops traces rather than queuing them or blocking reads", { timeout: 5000 }, async t => {
  const { lines, output } = traceCapture(t)
  output.writableNeedDrain = true
  const f = await fixture(LIMITS, output)
  let socket: Socket | undefined
  try {
    socket = await client(f.socketPath)
    const [reply] = await exchange(socket, rpc(1, "eth_chainId", []), 1)
    assert.equal(reply?.result, "0x2a")
    assert.equal(lines.length, 0)
    assert.ok(f.listener.diagnostics().suppressed > 0)
    assert.equal(f.listener.diagnostics().failure, null)
  } finally { socket?.destroy(); await f.close() }
})

test("inspection errors disclose only a fixed safe category, not caught error text", { timeout: 5000 }, async () => {
  const directory = mkdtempSync(join(tmpdir(), "approval-safe-inspection-"))
  const socketPath = join(directory, "rpc.sock")
  const backend: FixedBackend = {
    maxResponseBytes: 4096,
    async read() { throw new Error("unexpected read") },
    async send() { throw new Error("unexpected send") },
  }
  let cause = "Transaction inspection failed (Error); secret-internal-detail"
  const listener = await startRpcListener({
    socketPath, backend, maxMessageBytes: 4096, maxInFlight: 4, ...LIMITS,
    traceOutput: process.stderr,
    owner: { async submit() { throw new Error(cause) } },
  })
  let socket: Socket | undefined
  try {
    socket = await client(socketPath)
    const [inspection] = await exchange(socket, rpc(1, "eth_sendRawTransaction", ["0x02aa"]), 1)
    assert.deepEqual(inspection?.error, { code: -32000, message: "Transaction inspection failed" })
    cause = "unexpected failure revealing secret-internal-detail"
    const [unexpected] = await exchange(socket, rpc(2, "eth_sendRawTransaction", ["0x02aa"]), 1)
    assert.deepEqual(unexpected?.error, { code: -32000, message: "Approval request failed" })
    assert.equal(JSON.stringify([inspection, unexpected]).includes("secret-internal-detail"), false)
  } finally {
    socket?.destroy()
    try { await bounded("safe-inspection listener shutdown", listener.close(), 3_000) }
    finally { rmSync(directory, { recursive: true, force: true }) }
  }
})

test("missing budgets or trace output fail before opening the approval socket", async () => {
  const directory = mkdtempSync(join(tmpdir(), "approval-required-limits-"))
  const socketPath = join(directory, "rpc.sock")
  const backend: FixedBackend = {
    maxResponseBytes: 4096,
    async read() { throw new Error("must not read") },
    async send() { throw new Error("must not send") },
  }
  const options: ListenerOptions = {
    socketPath, backend, owner: { async submit() { throw new Error("must not submit") } },
    maxMessageBytes: 4096, maxInFlight: 4, ...LIMITS, traceOutput: process.stderr,
  }
  try {
    for (const field of ["maxConnectionAttempts", "connectionWindowMs"] as const) {
      for (const value of [undefined, null, 0, -1, NaN, Infinity]) {
        // Exercise the runtime boundary, including untyped/malformed callers.
        const invalid = { ...options, [field]: value } as unknown as ListenerOptions
        await assert.rejects(startRpcListener(invalid), /bounded capacities/)
        assert.equal(existsSync(socketPath), false)
      }
    }
    const missingTrace = { ...options, traceOutput: undefined } as unknown as ListenerOptions
    await assert.rejects(startRpcListener(missingTrace), /bounded capacities/)
    assert.equal(existsSync(socketPath), false)
  } finally { rmSync(directory, { recursive: true, force: true }) }
})
