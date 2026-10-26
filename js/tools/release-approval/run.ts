import { isAbsolute, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import type { Readable, Writable } from "node:stream"
import { getAddress, type Hex } from "viem"

import { readBoundedRegularFile } from "../release-files.ts"
import { openAudit } from "./audit.ts"
import { createFixedBackend, startRpcListener } from "./listener.ts"
import { ApprovalOwner } from "./owner.ts"
import { parseReferenceSnapshot, type ReleaseApp, type ReferenceSnapshot } from "./reference-read.ts"
import { ApprovalTerminal } from "./terminal.ts"
import { ReleaseVerifier, type CreationReceipt, type TransactionReview } from "./verifier.ts"

type OperatorInput = Readable & { isTTY?: boolean }
type OperatorOutput = Writable & { isTTY?: boolean }

export interface RuntimeSettings {
  referencePath: string
  referenceSha256: Hex
  sourceCommit: string
  planSha256: Hex
  app: ReleaseApp
  chainId: number
  deployer: string
  socketPath: string
  auditDir: string
  backendUrl: string
}

type RuntimeIO = { input: OperatorInput; output: OperatorOutput; signal?: AbortSignal }

// Only fixed, locally owned explanations may cross the CLI diagnostic boundary.
class ApprovalStartupError extends Error {}

function startupDiagnostic(error: unknown): string {
  if (error instanceof ApprovalStartupError) return error.message
  const facts: string[] = []
  if (error !== null && typeof error === "object") {
    for (const field of ["code", "syscall"] as const) {
      const value = (error as NodeJS.ErrnoException)[field]
      if (typeof value === "string" && /^[A-Za-z][A-Za-z0-9_]{0,39}$/.test(value)) facts.push(`${field}=${value}`)
    }
  }
  return `Unexpected error${facts.length ? ` (${facts.join(", ")})` : ""}`
}

function waitForOperatorStart(reference: ReferenceSnapshot, io: RuntimeIO): Promise<void> {
  if (io.signal?.aborted) return Promise.reject(new ApprovalStartupError("Operator start was interrupted"))
  if (io.input.destroyed || io.input.readableEnded || io.output.destroyed) {
    return Promise.reject(new ApprovalStartupError("Operator terminal detached before start"))
  }
  return new Promise<void>((resolve, reject) => {
    let command = ""
    let settled = false
    let commandAccepted = false
    let promptPending = true
    function clean(): void {
      io.input.off("data", onData)
      io.input.off("end", onDetach)
      io.input.off("close", onDetach)
      io.input.off("error", onDetach)
      io.output.off("close", onDetach)
      io.output.off("error", onDetach)
      io.output.off("drain", onDrain)
      io.signal?.removeEventListener("abort", onAbort)
    }
    function fail(message: string): void {
      if (settled) return
      settled = true
      clean()
      reject(new ApprovalStartupError(message))
    }
    const onDetach = () => fail("Operator terminal detached before start")
    const onAbort = () => fail("Operator start was interrupted")
    const maybeStart = () => {
      if (!commandAccepted || promptPending || settled) return
      settled = true
      clean()
      resolve()
    }
    const onDrain = () => { promptPending = false; maybeStart() }
    const onData = (chunk: Buffer | string) => {
      const bytes = typeof chunk === "string" ? Buffer.from(chunk, "utf8") : chunk
      if (Buffer.byteLength(command) + bytes.byteLength > 32) { fail("Operator start command exceeds 32 bytes"); return }
      command += bytes.toString("utf8")
      if (!command.includes("\n")) return
      if (command === "\n" || command === "\r\n") {
        command = ""
        if (!promptPending) writePrompt()
        return
      }
      if (command !== "start\n" && command !== "start\r\n") { fail("Operator start requires one exact start command without extra input"); return }
      commandAccepted = true
      maybeStart()
    }
    io.input.on("data", onData)
    io.input.on("end", onDetach)
    io.input.on("close", onDetach)
    io.input.on("error", onDetach)
    io.output.on("close", onDetach)
    io.output.on("error", onDetach)
    io.output.on("drain", onDrain)
    io.signal?.addEventListener("abort", onAbort, { once: true })
    const prompt = [
      "Release approval",
      `  App: ${reference.app}`,
      `  Chain ID: ${reference.expectedChainId}`,
      `  Signer: ${reference.expectedDeployer}`,
      `  Source commit: ${reference.sourceCommit}`,
      `  Reference SHA-256: ${reference.snapshotSha256}`,
      "Type start and press Enter to open the approval socket.",
      "",
    ].join("\n")
    function writePrompt(): void {
      promptPending = true
      try { if (io.output.write(prompt)) { promptPending = false; maybeStart() } }
      catch { fail("Operator terminal output failed before start") }
    }
    writePrompt()
    if (io.signal?.aborted) onAbort()
  })
}

function envValue(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]
  if (value === undefined || value.length === 0) throw new ApprovalStartupError(`Approval requires ${name}`)
  return value
}

function digest(value: string, name: string): Hex {
  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) throw new ApprovalStartupError(`${name} must be 32 hex bytes`)
  return value.toLowerCase() as Hex
}

export function settingsFromEnv(env: NodeJS.ProcessEnv): RuntimeSettings {
  const app = envValue(env, "RELEASE_APPROVAL_APP")
  if (app !== "escrow" && app !== "bike-nft" && app !== "pay-to-play") throw new ApprovalStartupError("Approval app must name an existing release")
  const sourceCommit = envValue(env, "RELEASE_APPROVAL_SOURCE_COMMIT")
  if (!/^[0-9a-f]{40}$/.test(sourceCommit)) throw new ApprovalStartupError("Approval source commit must be a full lowercase Git commit")
  const chainText = envValue(env, "RELEASE_APPROVAL_CHAIN_ID")
  if (!/^[1-9][0-9]*$/.test(chainText)) throw new ApprovalStartupError("Approval chain ID must be a positive decimal integer")
  const chainId = Number(chainText)
  if (!Number.isSafeInteger(chainId) || chainId < 1) throw new ApprovalStartupError("Approval chain ID must be a positive safe integer")
  const deployer = getAddress(envValue(env, "RELEASE_APPROVAL_DEPLOYER"))
  return {
    referencePath: envValue(env, "RELEASE_APPROVAL_REFERENCE_PATH"),
    referenceSha256: digest(envValue(env, "RELEASE_APPROVAL_REFERENCE_SHA256"), "Approval reference digest"),
    sourceCommit,
    planSha256: digest(envValue(env, "RELEASE_APPROVAL_PLAN_SHA256"), "Approval plan digest"),
    app, chainId, deployer,
    socketPath: envValue(env, "RELEASE_APPROVAL_SOCKET_PATH"),
    auditDir: envValue(env, "RELEASE_APPROVAL_AUDIT_DIR"),
    backendUrl: envValue(env, "RELEASE_APPROVAL_BACKEND_URL"),
  }
}

export function assertReferenceIdentity(reference: ReferenceSnapshot, selected: RuntimeSettings): void {
  if (reference.snapshotSha256.toLowerCase() !== selected.referenceSha256.toLowerCase() ||
      reference.sourceCommit !== selected.sourceCommit ||
      reference.planSha256.toLowerCase() !== selected.planSha256.toLowerCase() ||
      reference.app !== selected.app || reference.expectedChainId !== selected.chainId ||
      getAddress(reference.expectedDeployer) !== getAddress(selected.deployer)) {
    throw new ApprovalStartupError("Selected ceremony identity differs from release approval reference")
  }
}

export function approvalShutdownReason(
  signal: string,
  acceptedSteps: number,
  expectedSteps: number,
  ownerIdle: boolean,
  ownerClosedReason: string | null,
): string {
  if (signal !== "SIGTERM") return signal
  if (ownerClosedReason !== null) return `approval closed before completion: ${ownerClosedReason}`
  if (acceptedSteps === expectedSteps && ownerIdle) return "approval complete"
  return "release stopped before all approved steps completed"
}

function receiptFrom(value: unknown): CreationReceipt | null {
  if (value === null) return null
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("Creation receipt is not an object")
  const item = value as Record<string, unknown>
  if (typeof item.transactionHash !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(item.transactionHash) ||
      (item.status !== "0x1" && item.status !== "0x0") ||
      (item.contractAddress !== null && typeof item.contractAddress !== "string")) {
    throw new Error("Creation receipt lacks transaction hash, status or address")
  }
  return {
    transactionHash: item.transactionHash as Hex,
    status: item.status,
    contractAddress: item.contractAddress === null ? null : getAddress(item.contractAddress),
  }
}

export async function startApprovalRuntime(settings: RuntimeSettings, io: RuntimeIO): Promise<{
  close(reason: string): Promise<void>
  finished: Promise<string>
}> {
  if (!isAbsolute(settings.referencePath) || !isAbsolute(settings.socketPath) || !isAbsolute(settings.auditDir)) {
    throw new ApprovalStartupError("Approval reference, socket and audit paths must be absolute")
  }
  const reference = parseReferenceSnapshot(await readBoundedRegularFile(settings.referencePath, "release approval reference", 1024 * 1024))
  assertReferenceIdentity(reference, settings)
  if (io.input.isTTY !== true || io.output.isTTY !== true) throw new ApprovalStartupError("Approval requires an attached operator TTY")
  let detached = false
  const markDetached = () => { detached = true }
  const stopWatchingHandoff = () => {
    io.input.off("end", markDetached)
    io.input.off("close", markDetached)
    io.input.off("error", markDetached)
    io.output.off("close", markDetached)
    io.output.off("error", markDetached)
  }
  io.input.on("end", markDetached)
  io.input.on("close", markDetached)
  io.input.on("error", markDetached)
  io.output.on("close", markDetached)
  io.output.on("error", markDetached)
  try {
    await waitForOperatorStart(reference, io)
    if (io.signal?.aborted) throw new ApprovalStartupError("Operator start was interrupted")
    if (detached || io.input.destroyed || io.input.readableEnded || io.output.destroyed) {
      throw new ApprovalStartupError("Operator terminal detached before approval startup")
    }
  } catch (error) {
    stopWatchingHandoff()
    throw error
  }
  stopWatchingHandoff()

  const backend = createFixedBackend({ url: settings.backendUrl, timeoutMs: 45_000, maxResponseBytes: 1024 * 1024 })
  const durableAudit = openAudit(settings.auditDir)
  let listener: Awaited<ReturnType<typeof startRpcListener>> | null = null
  let timer: NodeJS.Timeout | null = null
  let closing: Promise<void> | null = null
  let resolveFinished: (reason: string) => void = () => {}
  const finished = new Promise<string>(resolve => { resolveFinished = resolve })
  let fatalReason: string | null = null
  let listenerFailure: string | null = null
  let review: TransactionReview | null = null
  let recordedClosure = false
  const audit = {
    append(event: Parameters<typeof durableAudit.append>[0]) {
      durableAudit.append(event)
      terminal.reportSubmission(event)
      if (event.kind === "closed") { recordedClosure = true; fatalReason = event.reason }
    },
  }

  const verifier = new ReleaseVerifier(reference, async hash => {
    const response = await backend.read({ jsonrpc: "2.0", id: `receipt-${hash}`, method: "eth_getTransactionReceipt", params: [hash] }, new AbortController().signal)
    if (response.error) throw new Error(`Creation receipt lookup failed (${response.error.code})`)
    return receiptFrom(response.result)
  })
  const owner = new ApprovalOwner({
    chainId: reference.expectedChainId, sender: getAddress(reference.expectedDeployer),
    referenceDigest: reference.snapshotSha256, approvalMs: 180_000,
    now: () => Date.now(), schedule: (callback, delay) => { const handle = setTimeout(callback, delay); return () => clearTimeout(handle) },
    audit, maxWaiters: 16, maxHistory: 128, send: raw => backend.send(raw),
    inspect: async raw => { review = await verifier.inspect(raw) },
    accepted: hash => {
      try { verifier.accepted(hash); review = null }
      catch {
        fatalReason = "accepted release step could not be recorded"
        throw new Error("Accepted release step could not be recorded")
      }
    },
    notAccepted: hash => { verifier.notAccepted(hash); review = null },
  })
  const terminal = new ApprovalTerminal({
    input: io.input, output: io.output, owner,
    reviewForHash: hash => review?.signed.hash === hash ? review : null,
    referenceName: `${reference.app} ${reference.sourceCommit}`,
    now: () => Date.now(), pageCharacters: 2048,
  })

  let startupComplete = false
  const onDetach = () => {
    detached = true
    if (startupComplete) void close("operator terminal detached")
  }
  function close(reason: string): Promise<void> {
    if (closing !== null) return closing
    closing = shutdown(reason)
    return closing
  }
  async function shutdown(reason: string): Promise<void> {
    const finalReason = approvalShutdownReason(
      reason, verifier.stepIndex(), reference.steps.length, owner.isIdle(), owner.closedReason(),
    )
    if (timer !== null) clearInterval(timer)
    let cleanupError: unknown = null
    try { owner.close(finalReason) } catch (error) { cleanupError = error }
    terminal.stop()
    io.input.off("end", onDetach)
    io.input.off("close", onDetach)
    io.input.off("error", onDetach)
    io.output.off("close", onDetach)
    io.output.off("error", onDetach)
    try { if (listener !== null) await listener.close() } catch (error) { if (cleanupError === null) cleanupError = error }
    await owner.whenSettled()
    if (!recordedClosure) {
      const ownerReason = owner.closedReason()
      try { audit.append({ kind: "closed", reason: ownerReason === null ? finalReason : ownerReason }) }
      catch (error) { if (cleanupError === null) cleanupError = error }
    }
    try { durableAudit.close() } catch (error) { if (cleanupError === null) cleanupError = error }
    resolveFinished(cleanupError === null ? finalReason : `${finalReason}; approval cleanup failed`)
    if (cleanupError !== null) throw new Error("Approval cleanup failed", { cause: cleanupError })
  }

  try {
    terminal.start()
    io.input.on("end", onDetach)
    io.input.on("close", onDetach)
    io.input.on("error", onDetach)
    io.output.on("close", onDetach)
    io.output.on("error", onDetach)
    listener = await startRpcListener({
      socketPath: settings.socketPath, backend, owner,
      maxMessageBytes: 262_144, maxConnections: 8, maxInFlight: 32,
      maxConnectionAttempts: 256, connectionWindowMs: 1_000,
      traceOutput: process.stderr,
      onFatal: reason => {
        listenerFailure = reason
        fatalReason = reason
        // The listener has already stopped admission. Close the decision owner
        // synchronously; no still-visible prompt may authorize a later send.
        try { owner.close(reason) } catch { process.exitCode = 1 }
        if (startupComplete) void close(reason).catch(() => { process.exitCode = 1 })
      },
    })
    if (io.signal?.aborted) throw new ApprovalStartupError("Approval startup was interrupted")
    if (detached || io.input.destroyed || io.input.readableEnded || io.output.destroyed) {
      throw new ApprovalStartupError("Operator terminal detached during approval startup")
    }
    // The owner also closes on terminal loss or inspection failure. Only the
    // listener callback may classify a startup failure as an IPC failure.
    if (listenerFailure !== null) throw new ApprovalStartupError("Approval IPC listener failed during startup")
    if (fatalReason !== null) throw new ApprovalStartupError("Approval ceremony closed during startup")
    timer = setInterval(() => {
      try {
        terminal.poll()
        if (fatalReason === null) fatalReason = owner.closedReason()
        if (fatalReason !== null) void close(fatalReason).catch(() => { process.exitCode = 1 })
      } catch { void close("operator terminal display failed").catch(() => { process.exitCode = 1 }) }
    }, 50)
    io.output.write(`Approval ready for ${reference.app}; chain ${reference.expectedChainId}; reference ${reference.snapshotSha256}\n`)
    startupComplete = true
  } catch (error) {
    try { await close(fatalReason === null ? "approval startup failed" : fatalReason) } catch { /* startup error remains primary */ }
    throw error
  }
  return { close, finished }
}

async function main(): Promise<void> {
  const settings = settingsFromEnv(process.env)
  const abortStart = new AbortController()
  let runtime: Awaited<ReturnType<typeof startApprovalRuntime>> | null = null
  const onInterrupt = () => {
    if (runtime === null) abortStart.abort()
    else void runtime.close("SIGINT").catch(() => { process.exitCode = 1 })
  }
  const onTerminate = () => {
    if (runtime === null) abortStart.abort()
    else void runtime.close("SIGTERM").catch(() => { process.exitCode = 1 })
  }
  process.once("SIGINT", onInterrupt)
  process.once("SIGTERM", onTerminate)
  try {
    runtime = await startApprovalRuntime(settings, { input: process.stdin, output: process.stdout, signal: abortStart.signal })
    if (abortStart.signal.aborted) await runtime.close("approval startup was interrupted")
    const reason = await runtime.finished
    if (reason !== "approval complete") process.exitCode = 1
    if (process.exitCode) process.stderr.write(`Approval stopped: ${reason}\n`)
  } finally {
    // Removing data listeners leaves stdin flowing and can keep the CLI alive.
    process.stdin.pause()
    process.off("SIGINT", onInterrupt)
    process.off("SIGTERM", onTerminate)
  }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    process.stderr.write(`Approval startup failed: ${startupDiagnostic(error)}\n`)
    process.exitCode = 1
  })
}
