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

export interface RpcTraceOutput {
  readonly destroyed: boolean
  readonly writableNeedDrain: boolean
  write(line: string): boolean
}

// Forge's optional eth_getAccountInfo probe receives -32601 and falls back to
// balance, nonce and code reads. Its rejection alone does not identify a stall.
const readMethods = new Set([
  "eth_chainId", "eth_blockNumber", "eth_getBlockByNumber", "eth_getBlockByHash",
  "eth_getBalance", "eth_getTransactionCount", "eth_getStorageAt", "eth_getProof",
  "eth_gasPrice", "eth_maxPriorityFeePerGas", "eth_feeHistory", "eth_estimateGas",
  "eth_createAccessList", "eth_call", "eth_getCode", "eth_getTransactionReceipt",
  "eth_getTransactionByHash",
])

function traceMethod(method: string): string {
  // An unknown method can itself contain credentials, even if it looks like an identifier.
  return readMethods.has(method) || method === "eth_sendRawTransaction" || method === "eth_getAccountInfo"
    ? method : "unlisted"
}

function socketErrorCode(cause: unknown): string {
  const code = object(cause) ? cause.code : undefined
  return typeof code === "string" && ["ECONNRESET", "EPIPE", "ECONNABORTED", "ETIMEDOUT"].includes(code)
    ? code : "other"
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
  /** A ceremony-wide connection-attempt budget, including rejected attempts. */
  maxConnectionAttempts: number
  connectionWindowMs: number
  /** Explicit trace sink keeps test backpressure independent of Node's own stderr. */
  traceOutput: RpcTraceOutput
  /** Called once after admission stops; the runtime must close the approval owner. */
  onFatal?: (reason: string) => void
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

export async function startRpcListener(options: ListenerOptions) {
  const parent = dirname(options.socketPath)
  const parentStat = lstatSync(parent)
  let socketExists = false
  try { lstatSync(options.socketPath); socketExists = true }
  catch (cause) { if (!object(cause) || cause.code !== "ENOENT") throw cause }
  const maxAttempts = options.maxConnectionAttempts
  const windowMs = options.connectionWindowMs
  if (!Number.isSafeInteger(options.maxMessageBytes) || options.maxMessageBytes < 128 ||
      !Number.isSafeInteger(options.maxConnections) || options.maxConnections < 1 ||
      !Number.isSafeInteger(options.maxInFlight) || options.maxInFlight < 1 ||
      !Number.isSafeInteger(maxAttempts) || maxAttempts < 1 ||
      !Number.isSafeInteger(windowMs) || windowMs < 1 ||
      !options.traceOutput || typeof options.traceOutput.write !== "function" ||
      typeof options.traceOutput.destroyed !== "boolean" ||
      typeof options.traceOutput.writableNeedDrain !== "boolean" || socketExists ||
      !parentStat.isDirectory() || parentStat.uid !== process.getuid?.() ||
      (parentStat.mode & 0o077) !== 0 || realpathSync(parent) !== resolve(parent)) {
    throw new Error("Approval socket requires fresh path and bounded capacities")
  }
  const clients = new Set<Socket>()
  const stats = {
    attempts: 0, accepted: 0, rejected: 0, active: 0, peak: 0,
    closed: 0, empty: 0, no_requests: 0, received_bytes: 0,
    requests: 0, responses: 0, rpc_errors: 0, parse_errors: 0,
    invalid_requests: 0, socket_errors: 0, write_failures: 0,
    canceled: 0, suppressed: 0,
  }
  let failure: string | null = null
  let stopped = false
  let closing: Promise<void> | null = null
  let summaryTimer: NodeJS.Timeout | null = null
  let windowStarted = performance.now()
  let windowAttempts = 0
  const tracing = process.env.RELEASE_APPROVAL_TRACE_RPC === "1"
  const traceOutput = options.traceOutput
  let traceBytes = 0
  let detailStarted = performance.now()
  let detailLines = 0

  // No per-empty-connection logging. Trace output has both a rate and lifetime
  // bound, and never queues more writes while the pipe reports backpressure.
  function traceRpc(message: string, summary: boolean) {
    if (!tracing) return
    const now = performance.now()
    if (now - detailStarted >= 1_000) { detailStarted = now; detailLines = 0 }
    const line = `approval RPC ${message}\n`
    const limit = summary ? 524_288 : 458_752 // reserve 64 KiB for summaries
    if ((!summary && detailLines >= 128) || traceBytes + Buffer.byteLength(line) > limit ||
        traceOutput.destroyed || traceOutput.writableNeedDrain) {
      stats.suppressed++
      return
    }
    if (!summary) detailLines++
    traceBytes += Buffer.byteLength(line)
    try { traceOutput.write(line) } catch { stats.suppressed++ }
  }
  function summary() {
    traceRpc(`stats ${Object.entries(stats).map(([key, value]) => `${key}=${value}`).join(" ")} stopped=${stopped ? 1 : 0}`, true)
  }
  function close(): Promise<void> {
    if (closing !== null) return closing
    stopped = true
    if (summaryTimer !== null) clearInterval(summaryTimer)
    closing = new Promise<void>(resolve => {
      for (const socket of clients) socket.destroy()
      server.close(() => { summary(); resolve() })
    })
    return closing
  }
  function fail(reason: string) {
    if (stopped) return
    failure = reason
    // Stop accepting and disconnect before notifying the owner. Never let
    // reconnection churn turn into an implicit retry of a signed transaction.
    void close()
    traceRpc(`fatal reason=${reason}`, true)
    options.onFatal?.(reason)
  }
  const server = createServer(socket => {
    socket.on("error", cause => {
      stats.socket_errors++
      traceRpc(`socket-error code=${socketErrorCode(cause)}`, false)
      socket.destroy()
    })
    if (stopped) { socket.destroy(); return }
    const connection = ++stats.attempts
    const now = performance.now()
    if (now - windowStarted >= windowMs) { windowStarted = now; windowAttempts = 0 }
    if (++windowAttempts > maxAttempts) {
      stats.rejected++
      socket.destroy()
      fail(`IPC connection storm: more than ${maxAttempts} attempts in ${windowMs}ms`)
      return
    }
    if (clients.size >= options.maxConnections) {
      stats.rejected++
      traceRpc(`connection=${connection} rejected=connection-limit active=${clients.size} limit=${options.maxConnections}`, false)
      socket.destroy()
      return
    }
    clients.add(socket)
    stats.accepted++
    stats.active = clients.size
    stats.peak = Math.max(stats.peak, stats.active)
    let nextRequest = 0
    let received = 0
    let closeReason = "peer-close"
    let bytes = Buffer.alloc(0)
    let admitting = true
    const active = new Map<string, AbortController>()
    socket.on("error", cause => { closeReason = `socket-error-${socketErrorCode(cause)}` })
    socket.on("end", () => { if (closeReason === "peer-close") closeReason = "peer-eof" })
    socket.on("close", () => {
      admitting = false
      clients.delete(socket)
      stats.active = clients.size
      stats.closed++
      if (received === 0) stats.empty++
      if (nextRequest === 0) stats.no_requests++
      if (received > 0 || closeReason.startsWith("socket-error")) {
        traceRpc(`connection=${connection} closed reason=${stopped ? "listener-stop" : closeReason} received_bytes=${received} requests=${nextRequest} active=${active.size}`, false)
      }
      for (const control of active.values()) control.abort()
    })
    function reply(response: RpcResponse, written?: (status: "flushed" | "failed" | "socket-closed" | "capacity-exceeded") => void) {
      if (socket.destroyed || socket.writableEnded) { written?.("socket-closed"); return }
      const encoded = JSON.stringify(response) + "\n"
      const ceiling = (options.backend.maxResponseBytes + 1024) * options.maxInFlight
      if (socket.writableLength + Buffer.byteLength(encoded) > ceiling) {
        stats.write_failures++
        closeReason = "outbound-capacity"
        written?.("capacity-exceeded")
        socket.destroy()
        return
      }
      socket.write(encoded, cause => {
        if (cause) stats.write_failures++
        written?.(cause ? "failed" : "flushed")
      })
    }
    async function dispatch(rpc: RpcRequest, control: AbortController) {
      const sequence = ++nextRequest
      stats.requests++
      const started = performance.now()
      const method = traceMethod(rpc.method)
      const trace = (message: string) => traceRpc(`connection=${connection} request=${sequence} method=${method} ${message}`, false)
      function respond(response: RpcResponse, outcome = response.error ? "error" : "result") {
        stats.responses++
        if (response.error) stats.rpc_errors++
        const code = response.error ? ` code=${response.error.code}` : ""
        reply(response, written => {
          trace(`response outcome=${outcome}${code} write=${written} elapsed_ms=${Math.round(performance.now() - started)}`)
        })
      }
      trace(`request params=${rpc.params.length}`)
      try {
        if (rpc.method === "eth_sendRawTransaction") {
          if (rpc.params.length !== 1 || typeof rpc.params[0] !== "string" || rpc.id === null) {
            respond(error(rpc.id, -32602, "Send requires one signed transaction and a non-null request ID"))
            return
          }
          const outcome: SubmissionResult = await options.owner.submit(rpc.params[0], control.signal)
          if (outcome.status === "accepted") respond({ jsonrpc: "2.0", id: rpc.id, result: outcome.hash }, outcome.status)
          else respond(error(rpc.id, -32000, `Transaction ${outcome.status}: ${outcome.reason}`), outcome.status)
        } else if (readMethods.has(rpc.method)) {
          respond(await options.backend.read(rpc, control.signal))
        } else {
          respond(error(rpc.id, -32601, "Method not found"), "method-not-found")
        }
      } catch (cause) {
        if (!control.signal.aborted) {
          // Inspection errors are already reduced by ApprovalOwner to a fixed
          // error-class token. Expose only this known category, never a caught
          // error message (which might contain untrusted RPC or secret text).
          const inspectionFailure = rpc.method === "eth_sendRawTransaction" &&
            cause instanceof Error &&
            /^Transaction inspection failed \([A-Za-z][A-Za-z0-9]{0,47}\)/.test(cause.message)
          if (inspectionFailure) {
            trace("failure type=transaction-inspection")
            respond(error(rpc.id, -32000, "Transaction inspection failed"))
          } else {
            trace("failure type=request-failed")
            respond(error(rpc.id, -32000, "Approval request failed"))
          }
        } else {
          stats.canceled++
          trace(`canceled elapsed_ms=${Math.round(performance.now() - started)}`)
        }
      } finally { active.delete(idKey(rpc.id)) }
    }
    function reject(rpcId: RpcId, reason: string, code: number, message: string) {
      stats.invalid_requests++
      traceRpc(`connection=${connection} request rejected=${reason}`, false)
      reply(error(rpcId, code, message))
    }
    function accept(value: unknown) {
      if (Array.isArray(value)) {
        reject(null, "batch", -32600, "JSON-RPC batches are not supported by the approval socket")
        return
      }
      let rpc: RpcRequest
      try {
        rpc = request(value)
        if (Object.keys(value as Record<string, unknown>).some(key => !["jsonrpc", "id", "method", "params"].includes(key)) ||
            !safeJsonNumbers(rpc.params, 0)) throw new Error("Unexpected or imprecise JSON-RPC field")
      }
      catch { reject(null, "invalid", -32600, "Invalid JSON-RPC request"); return }
      const key = idKey(rpc.id)
      if (active.has(key)) { reject(rpc.id, "duplicate-id", -32600, "Request ID is already active on this connection"); return }
      if (active.size >= options.maxInFlight) { reject(rpc.id, "capacity", -32000, "Too many requests on this connection"); return }
      const control = new AbortController()
      active.set(key, control)
      void dispatch(rpc, control)
    }
    socket.on("data", block => {
      if (!admitting || stopped) return
      received += block.length
      stats.received_bytes += block.length
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
        stats.parse_errors++
        closeReason = "invalid-or-oversized-frame"
        traceRpc(`connection=${connection} request rejected=${closeReason} received_bytes=${received}`, false)
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
  server.on("error", () => fail("IPC listener failed"))
  traceRpc(`limits connections=${options.maxConnections} in_flight=${options.maxInFlight} attempts=${maxAttempts} window_ms=${windowMs}`, true)
  if (tracing) { summaryTimer = setInterval(summary, 5_000); summaryTimer.unref() }
  return { close, diagnostics: () => ({ ...stats, failure }) }
}
