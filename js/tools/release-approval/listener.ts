import { chmodSync, lstatSync, realpathSync } from "node:fs"
import { createServer, type Socket } from "node:net"
import { dirname, resolve } from "node:path"
import type { Hex } from "viem"
import type { ApprovalOwner, SubmissionResult } from "./owner.ts"
import { parseStrictJson } from "./strict-json.ts"

type RpcId = string | number | null
export type RpcRequest = { jsonrpc: "2.0"; id: RpcId; method: string; params: unknown[] }
export type RpcResponse = { jsonrpc: "2.0"; id: RpcId; result?: unknown; error?: { code: number; message: string; data?: unknown } }
type Owner = Pick<ApprovalOwner, "submit">

function traceRpc(message: string): void {
  if (process.env.RELEASE_APPROVAL_TRACE_RPC === "1") process.stderr.write(`approval RPC ${message}\n`)
}

const readMethods = new Set([
  "eth_chainId", "eth_blockNumber", "eth_getBlockByNumber", "eth_getBlockByHash",
  "eth_getBalance", "eth_getTransactionCount", "eth_getStorageAt", "eth_getProof",
  "eth_gasPrice", "eth_maxPriorityFeePerGas", "eth_feeHistory", "eth_estimateGas",
  "eth_createAccessList", "eth_call", "eth_getCode", "eth_getTransactionReceipt",
  "eth_getTransactionByHash",
])

function traceMethod(method: string): string {
  return readMethods.has(method) || method === "eth_sendRawTransaction" ? method : "unlisted"
}

function error(id: RpcId, code: number, message: string): RpcResponse {
  return { jsonrpc: "2.0", id, error: { code, message } }
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function request(value: unknown): RpcRequest {
  if (!object(value) || value.jsonrpc !== "2.0" || typeof value.method !== "string" ||
      (value.params !== undefined && !Array.isArray(value.params)) || !(typeof value.id === "string" ||
      (typeof value.id === "number" && Number.isSafeInteger(value.id)) || value.id === null)) {
    throw new Error("Expected a JSON-RPC 2.0 request with a valid ID, method and positional parameters")
  }
  if (value.params === undefined) value.params = []
  return value as RpcRequest
}

function idKey(id: RpcId): string { return `${typeof id}:${String(id)}` }

export interface FixedBackendOptions { url: string; timeoutMs: number; maxResponseBytes: number }
export interface FixedBackend { readonly maxResponseBytes: number; read(request: RpcRequest, signal: AbortSignal): Promise<RpcResponse>; send(raw: Hex): Promise<Hex> }

export function createFixedBackend(options: FixedBackendOptions): FixedBackend {
  const url = new URL(options.url)
  if (url.protocol !== "http:" || url.username || url.password || url.hash ||
      !Number.isSafeInteger(options.timeoutMs) || options.timeoutMs < 1 ||
      !Number.isSafeInteger(options.maxResponseBytes) || options.maxResponseBytes < 1) {
    throw new Error("Approval backend requires a fixed HTTP URL and bounded request settings")
  }
  let nextId = 0
  async function forward(rpc: RpcRequest, signal?: AbortSignal): Promise<RpcResponse> {
    const deadline = AbortSignal.timeout(options.timeoutMs)
    const combined = signal ? AbortSignal.any([deadline, signal]) : deadline
    const response = await fetch(url, {
      method: "POST", headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(rpc), signal: combined, redirect: "error",
    })
    if (!response.ok) throw new Error(`Approval backend returned HTTP ${response.status}`)
    const length = response.headers.get("content-length")
    if (length !== null && Number(length) > options.maxResponseBytes) throw new Error("Approval backend response is too large")
    if (!response.body) throw new Error("Approval backend returned no body")
    const reader = response.body.getReader()
    const chunks: Uint8Array[] = []
    let size = 0
    try {
      for (;;) {
        const next = await reader.read()
        if (next.done) break
        size += next.value.byteLength
        if (size > options.maxResponseBytes) throw new Error("Approval backend response is too large")
        chunks.push(next.value)
      }
    } finally { await reader.cancel() }
    const body = Buffer.concat(chunks, size)
    const parsed = parseStrictJson(new TextDecoder("utf-8", { fatal: true }).decode(body))
    if (!object(parsed) || parsed.jsonrpc !== "2.0" || parsed.id !== rpc.id ||
        ("result" in parsed) === ("error" in parsed)) throw new Error("Approval backend returned an invalid or mismatched JSON-RPC response")
    if ("result" in parsed) return { jsonrpc: "2.0", id: rpc.id, result: parsed.result }
    if (!object(parsed.error) || !Number.isSafeInteger(parsed.error.code) || typeof parsed.error.message !== "string") {
      throw new Error("Approval backend returned an invalid JSON-RPC error")
    }
    const backendError: { code: number; message: string; data?: unknown } = {
      code: parsed.error.code as number, message: parsed.error.message,
    }
    if ("data" in parsed.error) backendError.data = parsed.error.data
    return { jsonrpc: "2.0", id: rpc.id, error: backendError }
  }
  return {
    maxResponseBytes: options.maxResponseBytes,
    read(rpc, signal) {
      if (!readMethods.has(rpc.method)) throw new Error("Read method is not allowed")
      return forward(rpc, signal)
    },
    async send(raw) {
      const rpc: RpcRequest = { jsonrpc: "2.0", id: `approval-${++nextId}`, method: "eth_sendRawTransaction", params: [raw] }
      const result = await forward(rpc)
      if (result.error) throw new Error(`Approval backend rejected transaction (${result.error.code})`)
      if (typeof result.result !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(result.result)) {
        throw new Error("Approval backend returned an invalid transaction hash")
      }
      return result.result as Hex
    },
  }
}

export interface ListenerOptions {
  socketPath: string
  backend: FixedBackend
  owner: Owner
  maxMessageBytes: number
  maxConnections: number
  maxInFlight: number
}

function safeJsonNumbers(value: unknown, depth: number): boolean {
  if (depth > 64) return false
  if (typeof value === "number") return Number.isSafeInteger(value)
  if (Array.isArray(value)) return value.every(item => safeJsonNumbers(item, depth + 1))
  if (object(value)) return Object.values(value).every(item => safeJsonNumbers(item, depth + 1))
  return true
}

function frameLength(bytes: Buffer): number | null {
  let start = 0
  while (start < bytes.length && (bytes[start] === 0x20 || bytes[start] === 0x0a || bytes[start] === 0x0d || bytes[start] === 0x09)) start++
  if (start === bytes.length) return null
  const open = bytes[start]
  if (open !== 0x7b && open !== 0x5b) throw new Error("IPC request must be a JSON object or batch")
  let depth = 0
  let quoted = false
  let escape = false
  for (let i = start; i < bytes.length; i++) {
    const c = bytes[i]
    if (quoted) {
      if (escape) escape = false
      else if (c === 0x5c) escape = true
      else if (c === 0x22) quoted = false
    } else if (c === 0x22) quoted = true
    else if (c === 0x7b || c === 0x5b) depth++
    else if (c === 0x7d || c === 0x5d) {
      depth--
      if (depth === 0) return i + 1
      if (depth < 0) throw new Error("Invalid IPC JSON framing")
    }
  }
  return null
}

export async function startRpcListener(options: ListenerOptions): Promise<{ close(): Promise<void> }> {
  const parent = dirname(options.socketPath)
  const parentStat = lstatSync(parent)
  let socketExists = false
  try { lstatSync(options.socketPath); socketExists = true }
  catch (cause) { if (!object(cause) || cause.code !== "ENOENT") throw cause }
  if (!Number.isSafeInteger(options.maxMessageBytes) || options.maxMessageBytes < 128 ||
      !Number.isSafeInteger(options.maxConnections) || options.maxConnections < 1 ||
      !Number.isSafeInteger(options.maxInFlight) || options.maxInFlight < 1 || socketExists ||
      !parentStat.isDirectory() || parentStat.uid !== process.getuid?.() ||
      (parentStat.mode & 0o077) !== 0 || realpathSync(parent) !== resolve(parent)) {
    throw new Error("Approval socket requires fresh path and bounded capacities")
  }
  const clients = new Set<Socket>()
  const server = createServer(socket => {
    if (clients.size >= options.maxConnections) { socket.destroy(); return }
    clients.add(socket)
    let bytes = Buffer.alloc(0)
    let admitting = true
    const active = new Map<string, AbortController>()
    socket.on("error", () => socket.destroy())
    socket.on("close", () => {
      admitting = false
      clients.delete(socket)
      for (const control of active.values()) control.abort()
    })
    function reply(response: RpcResponse) {
      if (socket.destroyed || socket.writableEnded) return
      const encoded = JSON.stringify(response) + "\n"
      const ceiling = (options.backend.maxResponseBytes + 1024) * options.maxInFlight
      if (socket.writableLength + Buffer.byteLength(encoded) > ceiling) { socket.destroy(); return }
      socket.write(encoded)
    }
    async function dispatch(rpc: RpcRequest, control: AbortController) {
      const method = traceMethod(rpc.method)
      try {
        if (rpc.method === "eth_sendRawTransaction") {
          if (rpc.params.length !== 1 || typeof rpc.params[0] !== "string" || rpc.id === null) {
            reply(error(rpc.id, -32602, "Send requires one signed transaction and a non-null request ID"))
            return
          }
          const outcome: SubmissionResult = await options.owner.submit(rpc.params[0], control.signal)
          traceRpc(`response method=${method} outcome=${outcome.status}`)
          if (outcome.status === "accepted") reply({ jsonrpc: "2.0", id: rpc.id, result: outcome.hash })
          else reply(error(rpc.id, -32000, `Transaction ${outcome.status}: ${outcome.reason}`))
        } else if (readMethods.has(rpc.method)) {
          const response = await options.backend.read(rpc, control.signal)
          traceRpc(`response method=${method} outcome=${"error" in response ? "error" : "result"}`)
          reply(response)
        } else reply(error(rpc.id, -32601, "Method not found"))
      } catch (cause) {
        if (!control.signal.aborted) {
          traceRpc(`failure method=${method} type=${cause instanceof Error ? cause.name : "unknown"}`)
          const message = cause instanceof Error ? cause.message : "Unknown request failure"
          reply(error(rpc.id, -32000, message))
        }
      } finally { active.delete(idKey(rpc.id)) }
    }
    function accept(value: unknown) {
      if (Array.isArray(value)) {
        traceRpc("request rejected=batch")
        reply(error(null, -32600, "JSON-RPC batches are not supported by the approval socket"))
        return
      }
      let rpc: RpcRequest
      try {
        rpc = request(value)
        if (Object.keys(value as Record<string, unknown>).some(key => !["jsonrpc", "id", "method", "params"].includes(key)) ||
            !safeJsonNumbers(rpc.params, 0)) throw new Error("Unexpected or imprecise JSON-RPC field")
      }
      catch { traceRpc("request rejected=invalid"); reply(error(null, -32600, "Invalid JSON-RPC request")); return }
      const method = traceMethod(rpc.method)
      traceRpc(`request method=${method} params=${rpc.params.length}`)
      const key = idKey(rpc.id)
      if (active.has(key)) { reply(error(rpc.id, -32600, "Request ID is already active on this connection")); return }
      if (active.size >= options.maxInFlight) { reply(error(rpc.id, -32000, "Too many requests on this connection")); return }
      const control = new AbortController()
      active.set(key, control)
      void dispatch(rpc, control)
    }
    socket.on("data", block => {
      if (!admitting) return
      bytes = Buffer.concat([bytes, block])
      try {
        for (;;) {
          const length = frameLength(bytes)
          if (length === null) {
            if (bytes.length > options.maxMessageBytes) throw new Error("IPC request exceeds byte limit")
            break
          }
          if (length > options.maxMessageBytes) throw new Error("IPC request exceeds byte limit")
          const frame = bytes.subarray(0, length)
          bytes = bytes.subarray(length)
          accept(parseStrictJson(new TextDecoder("utf-8", { fatal: true }).decode(frame)))
        }
      } catch {
        admitting = false
        bytes = Buffer.alloc(0)
        for (const control of active.values()) control.abort()
        reply(error(null, -32700, "Invalid or oversized IPC JSON request"))
        socket.end()
      }
    })
  })
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject)
      server.listen(options.socketPath, () => { server.off("error", reject); resolve() })
    })
    chmodSync(options.socketPath, 0o600)
  } catch (cause) { server.close(); throw cause }
  return { close: async () => {
    for (const socket of clients) socket.destroy()
    await new Promise<void>(resolve => server.close(() => resolve()))
  } }
}
