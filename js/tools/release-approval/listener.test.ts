import assert from "node:assert/strict"
import { createServer as createHttpServer } from "node:http"
import { connect } from "node:net"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import type { Hex } from "viem"
import { createFixedBackend, startRpcListener } from "./listener.ts"
import { parseStrictJson } from "./strict-json.ts"

type Rpc = { jsonrpc: string; id: string | number | null; result?: unknown; error?: { code: number; message: string } }

async function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "cam-approval-listener-"))
  const socketPath = join(directory, "rpc.sock")
  const forwarded: unknown[] = []
  const backend = createHttpServer(async (request, response) => {
    let body = ""
    for await (const chunk of request) body += chunk.toString()
    const rpc = JSON.parse(body)
    forwarded.push(rpc)
    response.setHeader("content-type", "application/json")
    response.end(JSON.stringify({ jsonrpc: "2.0", id: rpc.id, result: rpc.method === "eth_sendRawTransaction" ? "0x" + "a".repeat(64) : "0x2a" }))
  })
  await new Promise<void>(resolve => backend.listen(0, "127.0.0.1", resolve))
  const address = backend.address()
  if (!address || typeof address === "string") throw new Error("Missing test backend address")
  const fixed = createFixedBackend({ url: `http://127.0.0.1:${address.port}/`, timeoutMs: 2_000, maxResponseBytes: 4_096 })
  let release: ((value: { status: "accepted"; hash: Hex }) => void) | undefined
  const submissions: string[] = []
  let aborted = 0
  const owner = {
    submit(raw: string, signal?: AbortSignal) {
      submissions.push(raw)
      return new Promise<{ status: "accepted"; hash: Hex }>((resolve, reject) => {
        release = resolve
        signal?.addEventListener("abort", () => { aborted++; reject(new Error("disconnected")) }, { once: true })
      })
    },
  }
  const listener = await startRpcListener({
    socketPath, backend: fixed, owner, maxMessageBytes: 4_096, maxConnections: 4, maxInFlight: 4,
    maxConnectionAttempts: 256, connectionWindowMs: 1_000,
  })
  return {
    socketPath, forwarded, submissions, aborted: () => aborted,
    release: () => release?.({ status: "accepted", hash: "0x" + "a".repeat(64) as Hex }),
    close: async () => { await listener.close(); backend.closeAllConnections(); await new Promise<void>(resolve => backend.close(() => resolve())); rmSync(directory, { recursive: true, force: true }) },
  }
}

async function client(socketPath: string) {
  const socket = connect(socketPath)
  await new Promise<void>((resolve, reject) => { socket.once("connect", resolve); socket.once("error", reject) })
  let buffer = ""
  const queue: Rpc[] = []
  const waiters: ((rpc: Rpc) => void)[] = []
  socket.on("data", data => {
    buffer += data.toString()
    for (;;) {
      const end = buffer.indexOf("\n")
      if (end < 0) break
      const next = JSON.parse(buffer.slice(0, end)) as Rpc
      buffer = buffer.slice(end + 1)
      const waiter = waiters.shift()
      if (waiter) waiter(next)
      else queue.push(next)
    }
  })
  return {
    write: (value: string | Buffer) => socket.write(value),
    next: () => new Promise<Rpc>(resolve => { const next = queue.shift(); if (next) resolve(next); else waiters.push(resolve) }),
    close: () => socket.destroy(),
  }
}

function rpc(id: Rpc["id"], method: string, params: unknown[]): string {
  return JSON.stringify({ jsonrpc: "2.0", id, method, params })
}

test("fragmented and coalesced IPC requests retain their IDs", async () => {
  const f = await fixture()
  try {
    const c = await client(f.socketPath)
    const first = rpc("first", "eth_chainId", [])
    c.write(first.slice(0, 12))
    c.write(first.slice(12) + rpc("second", "eth_blockNumber", []))
    const answers = [await c.next(), await c.next()]
    assert.deepEqual(answers.map(answer => answer.id).sort(), ["first", "second"])
    assert.equal(f.forwarded.length, 2)
    c.close()
  } finally { await f.close() }
})

test("JSON-RPC reads may omit params and are forwarded with an empty positional list", async () => {
  const f = await fixture()
  try {
    const c = await client(f.socketPath)
    c.write('{"jsonrpc":"2.0","id":"chain","method":"eth_chainId"}')
    const answer = await c.next()
    assert.equal(answer.id, "chain")
    assert.equal(answer.result, "0x2a")
    assert.deepEqual(f.forwarded, [{ jsonrpc: "2.0", id: "chain", method: "eth_chainId", params: [] }])
    c.close()
  } finally { await f.close() }
})

test("unsupported account-info probe permits fallback reads and keeps submission gated", { timeout: 5_000 }, async () => {
  const f = await fixture()
  try {
    const c = await client(f.socketPath)
    const address = "0x" + "1".repeat(40)
    c.write(rpc(1, "eth_getAccountInfo", [address, "latest"]))
    assert.deepEqual(await c.next(), {
      jsonrpc: "2.0", id: 1, error: { code: -32601, message: "Method not found" },
    })
    assert.deepEqual(f.forwarded, [])
    assert.deepEqual(f.submissions, [])

    const fallback = ["eth_getBalance", "eth_getTransactionCount", "eth_getCode"].map((method, i) => ({
      jsonrpc: "2.0", id: i + 2, method, params: [address, "latest"],
    }))
    c.write(fallback.map(request => JSON.stringify(request)).join(""))
    const answers = await Promise.all([c.next(), c.next(), c.next()])
    assert.deepEqual(answers.map(answer => answer.id).sort(), [2, 3, 4])
    assert.ok(answers.every(answer => answer.result === "0x2a" && answer.error === undefined))
    assert.equal(f.forwarded.length, 3)
    for (const request of fallback) {
      assert.ok(f.forwarded.some(value => JSON.stringify(value) === JSON.stringify(request)))
    }

    c.write(rpc(5, "eth_sendRawTransaction", ["0x02aa"]) + rpc(6, "eth_chainId", []))
    assert.deepEqual(await c.next(), { jsonrpc: "2.0", id: 6, result: "0x2a" })
    assert.deepEqual(f.submissions, ["0x02aa"])
    assert.equal(f.forwarded.length, 4)
    f.release()
    assert.deepEqual(await c.next(), { jsonrpc: "2.0", id: 5, result: "0x" + "a".repeat(64) })
    assert.equal(f.forwarded.length, 4)
    c.close()
  } finally { await f.close() }
})

test("RPC trace correlates flushed replies without request IDs or payloads", { timeout: 5_000 }, async t => {
  const previous = process.env.RELEASE_APPROVAL_TRACE_RPC
  process.env.RELEASE_APPROVAL_TRACE_RPC = "1"
  const trace: string[] = []
  t.mock.method(process.stderr, "write", (chunk: string | Uint8Array) => {
    trace.push(chunk.toString())
    return true
  })
  let f: Awaited<ReturnType<typeof fixture>> | undefined
  try {
    f = await fixture()
    const first = await client(f.socketPath)
    const second = await client(f.socketPath)
    const sensitiveId = "credential-bearing-request-id"
    const address = "0x" + "c".repeat(40)
    const callData = "0xdeadbeef" + "ab".repeat(32)
    first.write(rpc(sensitiveId, "eth_getAccountInfo", [address, "latest"]))
    second.write(rpc(sensitiveId, "eth_call", [{ to: address, data: callData }, "latest"]))
    const [unsupported, read] = await Promise.all([first.next(), second.next()])
    assert.equal(unsupported.id, sensitiveId)
    assert.equal(unsupported.error?.code, -32601)
    assert.equal(read.id, sensitiveId)
    assert.equal(read.result, "0x2a")
    await new Promise<void>(resolve => setImmediate(resolve))

    const output = trace.join("")
    const requests = [...output.matchAll(/connection=(\d+) request=(\d+) method=([A-Za-z0-9_.]+) request params=2/g)]
    const responses = [...output.matchAll(/connection=(\d+) request=(\d+) method=([A-Za-z0-9_.]+) response outcome=(?:method-not-found code=-32601|result) write=flushed elapsed_ms=\d+/g)]
    assert.equal(requests.length, 2)
    assert.equal(responses.length, 2)
    assert.equal(new Set(requests.map(entry => entry[1])).size, 2)
    const identity = (entry: RegExpMatchArray) => entry[1] + ":" + entry[2] + ":" + entry[3]
    assert.deepEqual(responses.map(identity).sort(), requests.map(identity).sort())
    for (const sensitive of [sensitiveId, address, callData]) assert.equal(output.includes(sensitive), false)
    first.close()
    second.close()
  } finally {
    try { await f?.close() }
    finally {
      if (previous === undefined) delete process.env.RELEASE_APPROVAL_TRACE_RPC
      else process.env.RELEASE_APPROVAL_TRACE_RPC = previous
      t.mock.restoreAll()
    }
  }
})

test("a held send leaves reads responsive on the same socket", async () => {
  const f = await fixture()
  try {
    const c = await client(f.socketPath)
    c.write(rpc("send", "eth_sendRawTransaction", ["0x02aa"]) + rpc("read", "eth_blockNumber", []))
    const read = await c.next()
    assert.equal(read.id, "read")
    assert.equal(read.result, "0x2a")
    assert.deepEqual(f.submissions, ["0x02aa"])
    assert.equal(f.forwarded.length, 1)
    f.release()
    const sent = await c.next()
    assert.equal(sent.id, "send")
    assert.equal(sent.result, "0x" + "a".repeat(64))
    c.close()
  } finally { await f.close() }
})

test("batches containing a write reject before forwarding any member", async () => {
  const f = await fixture()
  try {
    const c = await client(f.socketPath)
    c.write("[" + rpc("read", "eth_chainId", []) + "," + rpc("send", "eth_sendRawTransaction", ["0x02aa"]) + "]")
    const answer = await c.next()
    assert.ok(answer.error)
    assert.equal(f.forwarded.length, 0)
    assert.equal(f.submissions.length, 0)
    c.close()
  } finally { await f.close() }
})

test("duplicate keys, duplicate live IDs, notifications and non-allowlisted methods are refused", async () => {
  const f = await fixture()
  try {
    const c = await client(f.socketPath)
    c.write('{"jsonrpc":"2.0","id":"one","method":"eth_chainId","method":"eth_sendRawTransaction","params":["0x02aa"]}')
    assert.ok((await c.next()).error)
    c.close()
    const live = await client(f.socketPath)
    live.write(rpc("hold", "eth_sendRawTransaction", ["0x02aa"]))
    live.write(rpc("hold", "eth_chainId", []))
    assert.equal((await live.next()).id, "hold")
    live.write(JSON.stringify({ jsonrpc: "2.0", method: "eth_chainId", params: [] }))
    assert.ok((await live.next()).error)
    live.write(rpc("forbidden", "eth_sendTransaction", [{}]))
    assert.equal((await live.next()).error?.code, -32601)
    assert.equal(f.forwarded.length, 0)
    live.close()
  } finally { await f.close() }
})

test("oversized and truncated inputs cannot be forwarded", async () => {
  const f = await fixture()
  try {
    const c = await client(f.socketPath)
    c.write("{" + " ".repeat(4_096))
    await new Promise(resolve => setTimeout(resolve, 20))
    assert.equal(f.forwarded.length, 0)
    c.close()
    const other = await client(f.socketPath)
    other.write('{"jsonrpc":"2.0","id":1,"method":')
    other.close()
    assert.equal(f.forwarded.length, 0)
  } finally { await f.close() }
})

test("fixed backend rejects a mismatched response ID", async () => {
  const f = await fixture()
  try {
    await assert.rejects(fixedReadWrongId(f.socketPath), /mismatched|invalid/i)
  } finally { await f.close() }
})

test("a socket loss aborts only its pending waiter and later reads still work", async () => {
  const f = await fixture()
  try {
    const departing = await client(f.socketPath)
    departing.write(rpc("send", "eth_sendRawTransaction", ["0x02aa"]))
    await new Promise(resolve => setTimeout(resolve, 10))
    assert.equal(f.submissions.length, 1)
    departing.close()
    const remaining = await client(f.socketPath)
    remaining.write(rpc("read", "eth_chainId", []))
    assert.equal((await remaining.next()).result, "0x2a")
    remaining.close()
  } finally { await f.close() }
})

test("unknown request fields and unsafe numeric JSON values never reach the backend", async () => {
  const f = await fixture()
  try {
    const c = await client(f.socketPath)
    c.write(JSON.stringify({ jsonrpc: "2.0", id: "extra", method: "eth_chainId", params: [], backendUrl: "http://example.test" }))
    assert.ok((await c.next()).error)
    c.write('{"jsonrpc":"2.0","id":"unsafe","method":"eth_call","params":[9007199254740993]}')
    assert.ok((await c.next()).error)
    assert.equal(f.forwarded.length, 0)
    c.close()
  } finally { await f.close() }
})

test("a malformed frame closes admission before a later valid write", async () => {
  const f = await fixture()
  try {
    const c = await client(f.socketPath)
    c.write('{"jsonrpc":"2.0","id":"bad","method":"eth_chainId","params":[],}')
    assert.equal((await c.next()).error?.code, -32700)
    c.write(rpc("late", "eth_sendRawTransaction", ["0x02aa"]))
    await new Promise(resolve => setTimeout(resolve, 20))
    assert.deepEqual(f.submissions, [])
    c.close()
  } finally { await f.close() }
})

test("a malformed frame cancels an outstanding approval waiter", async () => {
  const f = await fixture()
  try {
    const c = await client(f.socketPath)
    c.write(rpc("send", "eth_sendRawTransaction", ["0x02aa"]))
    await new Promise(resolve => setTimeout(resolve, 10))
    assert.equal(f.submissions.length, 1)
    c.write("{broken}")
    assert.equal((await c.next()).error?.code, -32700)
    await new Promise(resolve => setTimeout(resolve, 20))
    assert.equal(f.aborted(), 1)
    c.close()
  } finally { await f.close() }
})

test("UTF-8 split across chunks and escaped framing delimiters preserve exact IDs", async () => {
  const f = await fixture()
  try {
    const c = await client(f.socketPath)
    const id = 'snowman ☃ and escaped } { " bracket'
    const bytes = Buffer.from(rpc(id, "eth_chainId", []))
    const split = bytes.indexOf(Buffer.from("☃")) + 1
    c.write(bytes.subarray(0, split))
    c.write(bytes.subarray(split))
    assert.equal((await c.next()).id, id)
    c.close()
  } finally { await f.close() }
})

test("excessive JSON nesting is rejected before forwarding", async () => {
  const f = await fixture()
  try {
    const c = await client(f.socketPath)
    c.write('{"jsonrpc":"2.0","id":1,"method":"eth_call","params":' + "[".repeat(70) + "0" + "]".repeat(70) + "}")
    assert.equal((await c.next()).error?.code, -32700)
    assert.equal(f.forwarded.length, 0)
    c.close()
  } finally { await f.close() }
})

test("fixed backend rejects oversized and malformed response envelopes", async () => {
  const invalid = [
    '{"jsonrpc":"2.0","id":"check","result":"' + "a".repeat(4_096) + '"}',
    '{"jsonrpc":"2.0","id":"check","error":{"code":"bad","message":"bad"}}',
    '{"jsonrpc":"2.0","id":"check","error":{"code":-1}}',
    '{"jsonrpc":"2.0","id":"check","result":"0x1","error":{"code":-1,"message":"bad"}}',
  ]
  for (const body of invalid) {
    const backend = createHttpServer((_request, response) => response.end(body))
    await new Promise<void>(resolve => backend.listen(0, "127.0.0.1", resolve))
    const address = backend.address()
    if (!address || typeof address === "string") throw new Error("Missing test backend address")
    try {
      const fixed = createFixedBackend({ url: `http://127.0.0.1:${address.port}/`, timeoutMs: 2_000, maxResponseBytes: 4_096 })
      await assert.rejects(fixed.read({ jsonrpc: "2.0", id: "check", method: "eth_chainId", params: [] }, new AbortController().signal))
    } finally { backend.closeAllConnections(); await new Promise<void>(resolve => backend.close(() => resolve())) }
  }
})

test("fixed backend strips undeclared response fields but preserves standard error data", async () => {
  const bodies = [
    '{"jsonrpc":"2.0","id":"check","result":"0x1","extra":"secret"}',
    '{"jsonrpc":"2.0","id":"check","error":{"code":-1,"message":"failed","data":"0xdead","private":"secret"},"extra":"secret"}',
  ]
  for (const body of bodies) {
    const backend = createHttpServer((_request, response) => response.end(body))
    await new Promise<void>(resolve => backend.listen(0, "127.0.0.1", resolve))
    const address = backend.address()
    if (!address || typeof address === "string") throw new Error("Missing test backend address")
    try {
      const fixed = createFixedBackend({ url: `http://127.0.0.1:${address.port}/`, timeoutMs: 2_000, maxResponseBytes: 4_096 })
      const answer = await fixed.read({ jsonrpc: "2.0", id: "check", method: "eth_chainId", params: [] }, new AbortController().signal)
      assert.equal(JSON.stringify(answer).includes("secret"), false)
      if (answer.error) assert.deepEqual(answer.error, { code: -1, message: "failed", data: "0xdead" })
      else assert.equal(answer.result, "0x1")
    } finally { backend.closeAllConnections(); await new Promise<void>(resolve => backend.close(() => resolve())) }
  }
})

test("RPC JSON rejects numeric tokens that cannot round-trip exactly", () => {
  for (const token of ["1e999", "1e0", "1.0000000000000001", "-0", "9007199254740992", "-9007199254740992"]) {
    assert.throws(() => parseStrictJson(`{"value":${token}}`), /number|integer|numeric/i, token)
  }
  assert.deepEqual(parseStrictJson('{"value":9007199254740991}'), { value: 9007199254740991 })
})

test("unsafe numeric tokens in backend results and error data are rejected", async () => {
  for (const body of [
    '{"jsonrpc":"2.0","id":"check","result":1e999}',
    '{"jsonrpc":"2.0","id":"check","result":1.0000000000000001}',
    '{"jsonrpc":"2.0","id":"check","error":{"code":-1,"message":"failed","data":{"value":9007199254740992}}}',
  ]) {
    const backend = createHttpServer((_request, response) => response.end(body))
    await new Promise<void>(resolve => backend.listen(0, "127.0.0.1", resolve))
    const address = backend.address()
    if (!address || typeof address === "string") throw new Error("Missing test backend address")
    try {
      const fixed = createFixedBackend({ url: `http://127.0.0.1:${address.port}/`, timeoutMs: 2_000, maxResponseBytes: 4_096 })
      await assert.rejects(fixed.read({ jsonrpc: "2.0", id: "check", method: "eth_chainId", params: [] }, new AbortController().signal))
    } finally { backend.closeAllConnections(); await new Promise<void>(resolve => backend.close(() => resolve())) }
  }
})

test("an inexact numeric request is rejected before any backend call", async () => {
  const f = await fixture()
  try {
    const c = await client(f.socketPath)
    c.write('{"jsonrpc":"2.0","id":"bad","method":"eth_call","params":[1.0000000000000001]}')
    assert.equal((await c.next()).error?.code, -32700)
    assert.equal(f.forwarded.length, 0)
    c.close()
  } finally { await f.close() }
})

async function fixedReadWrongId(_socketPath: string) {
  const backend = createHttpServer((_request, response) => response.end('{"jsonrpc":"2.0","id":"wrong","result":"0x1"}'))
  await new Promise<void>(resolve => backend.listen(0, "127.0.0.1", resolve))
  const address = backend.address()
  if (!address || typeof address === "string") throw new Error("Missing test backend address")
  try {
    const fixed = createFixedBackend({ url: `http://127.0.0.1:${address.port}/`, timeoutMs: 2_000, maxResponseBytes: 4_096 })
    return await fixed.read({ jsonrpc: "2.0", id: "expected", method: "eth_chainId", params: [] }, new AbortController().signal)
  } finally { backend.closeAllConnections(); await new Promise<void>(resolve => backend.close(() => resolve())) }
}
