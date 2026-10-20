import { randomUUID } from "node:crypto"
import { getAddress, keccak256, parseTransaction, recoverTransactionAddress, serializeTransaction, type Address, type Hex } from "viem"

export type AuditEvent =
  | { kind: "pending"; hash: Hex; sender: Address; chainId: number; nonce: number; referenceDigest: Hex; challenge: string }
  | { kind: "approved"; hash: Hex; challenge: string }
  | { kind: "transmitting"; hash: Hex }
  | { kind: "accepted"; hash: Hex }
  | { kind: "uncertain"; hash: Hex; reason: string }
  | { kind: "closed"; reason: string; hash?: Hex }

export interface Audit { append(event: AuditEvent): void }
export type SubmissionResult =
  | { status: "accepted"; hash: Hex; continuationFailure?: string }
  | { status: "refused" | "uncertain"; hash: Hex; reason: string }

type Candidate = { raw: Hex; hash: Hex; sender: Address; chainId: number; nonce: number }
type Pending = Candidate & { challenge: string; deadline: number; waiters: Set<Waiter>; cancelExpiry: () => void }
type Waiter = { resolve(value: SubmissionResult): void; signal?: AbortSignal; onAbort?: () => void }
type Admission = Candidate & { inspection: Promise<Error | null>; waiters: number; canceled: boolean; completed: boolean; released: boolean }

export interface ApprovalOptions {
  chainId: number
  sender: Address
  referenceDigest: Hex
  approvalMs: number
  now: () => number
  schedule: (callback: () => void, delayMs: number) => () => void
  audit: Audit
  inspect: (raw: Hex) => Promise<void>
  accepted: (hash: Hex) => Promise<void> | void
  notAccepted: (hash: Hex) => void
  send: (raw: Hex) => Promise<Hex>
  maxWaiters: number
  maxHistory: number
}

const secp256k1HalfOrder = 0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0n

function safeErrorClass(error: unknown): string {
  return error instanceof Error && /^[A-Za-z][A-Za-z0-9]{0,47}$/.test(error.name) ? error.name : "UnknownError"
}

async function inspect(rawInput: string): Promise<Candidate> {
  if (!/^0x02(?:[0-9a-fA-F]{2})+$/.test(rawInput) || rawInput.length > 262_146) {
    throw new Error("Expected a bounded signed type-2 transaction")
  }
  const raw = rawInput.toLowerCase() as `0x02${string}`
  let parsed: ReturnType<typeof parseTransaction>
  try { parsed = parseTransaction(raw) }
  catch (error) { throw new Error(`Cannot decode signed type-2 transaction (${safeErrorClass(error)})`) }
  if (parsed.type !== "eip1559" || parsed.r === undefined || parsed.s === undefined || parsed.yParity === undefined ||
      BigInt(parsed.r) === 0n || BigInt(parsed.s) === 0n || BigInt(parsed.s) > secp256k1HalfOrder ||
      (parsed.yParity !== 0 && parsed.yParity !== 1)) throw new Error("Expected a valid signed type-2 transaction")
  let canonical: Hex
  try { canonical = serializeTransaction(parsed) }
  catch (error) { throw new Error(`Cannot validate signed transaction encoding (${safeErrorClass(error)})`) }
  if (canonical.toLowerCase() !== raw) throw new Error("Signed transaction has noncanonical bytes")
  let sender: Address
  try { sender = await recoverTransactionAddress({ serializedTransaction: raw }) }
  catch (error) { throw new Error(`Cannot recover transaction sender (${safeErrorClass(error)})`) }
  if (parsed.chainId === undefined || parsed.nonce === undefined) throw new Error("Signed transaction lacks chain ID or nonce")
  return { raw, hash: keccak256(raw), sender, chainId: parsed.chainId, nonce: parsed.nonce }
}

export class ApprovalOwner {
  private readonly options: ApprovalOptions
  private current: Pending | null = null
  private transmitting: Pending | null = null
  private admitting: Admission | null = null
  private transmissionDone: Promise<void> | null = null
  private finishTransmission: (() => void) | null = null
  private readonly outcomes = new Map<Hex, SubmissionResult>()
  private closed: string | null = null

  constructor(options: ApprovalOptions) {
    if (!Number.isSafeInteger(options.chainId) || options.chainId < 1 ||
        !Number.isFinite(options.approvalMs) || options.approvalMs <= 0 ||
        !/^0x[0-9a-fA-F]{64}$/.test(options.referenceDigest) ||
        !Number.isSafeInteger(options.maxWaiters) || options.maxWaiters < 1 ||
        !Number.isSafeInteger(options.maxHistory) || options.maxHistory < 1) {
      throw new Error("Approval requires a valid chain, reference digest and bounded limits")
    }
    getAddress(options.sender)
    this.options = options
  }

  pending() {
    const p = this.current
    return p === null ? null : { hash: p.hash, sender: p.sender, chainId: p.chainId,
      nonce: p.nonce, challenge: p.challenge, deadline: p.deadline,
      referenceDigest: this.options.referenceDigest }
  }

  whenSettled(): Promise<void> {
    if (this.transmissionDone !== null) return this.transmissionDone
    return Promise.resolve()
  }

  closedReason(): string | null { return this.closed }

  isIdle(): boolean { return this.current === null && this.transmitting === null && this.admitting === null }

  async submit(rawInput: string, signal?: AbortSignal): Promise<SubmissionResult> {
    const candidate = await inspect(rawInput)
    if (candidate.chainId !== this.options.chainId) throw new Error("Signed transaction targets a different chain")
    if (getAddress(candidate.sender) !== getAddress(this.options.sender)) throw new Error("Signed transaction sender differs from selected deployer")
    const previous = this.outcomes.get(candidate.hash)
    if (previous) return previous
    if (this.current !== null && this.options.now() >= this.current.deadline) this.closePending("approval expired")
    const expired = this.outcomes.get(candidate.hash)
    if (expired) return expired
    const active = this.current !== null ? this.current : this.transmitting
    const retryOfTransmitting = this.transmitting !== null && candidate.hash === this.transmitting.hash
    if (this.closed !== null && !retryOfTransmitting) throw new Error(`Approval ceremony closed: ${this.closed}`)
    if (active !== null && candidate.hash !== active.hash) throw new Error("Another transaction is awaiting approval or transmission")
    if (active === null) {
      await this.admit(candidate, signal)
      if (this.closed !== null) throw new Error(`Approval ceremony closed: ${this.closed}`)
      if (signal?.aborted) throw new Error("Approval waiter disconnected")
      const afterAdmission = this.current !== null ? this.current : this.transmitting
      if (afterAdmission !== null && afterAdmission.hash !== candidate.hash) throw new Error("Another transaction is awaiting approval or transmission")
      if (afterAdmission === null && (this.admitting === null || this.admitting.raw !== candidate.raw)) {
        throw new Error("Approval admission changed before request could be recorded")
      }
    }
    if (this.current === null && this.transmitting === null) {
      if (this.outcomes.size >= this.options.maxHistory) {
        this.releaseReservation(candidate.hash)
        this.close("Approval history limit reached")
        throw new Error("Approval history limit reached")
      }
      const pending: Pending = { ...candidate, challenge: randomUUID(), deadline: this.options.now() + this.options.approvalMs,
        waiters: new Set(), cancelExpiry: () => {} }
      if (this.closed !== null || this.admitting?.raw !== candidate.raw) {
        throw new Error(`Approval ceremony closed: ${this.closed === null ? "admission changed" : this.closed}`)
      }
      try { this.options.audit.append({ kind: "pending", hash: candidate.hash, sender: candidate.sender,
        chainId: candidate.chainId, nonce: candidate.nonce, referenceDigest: this.options.referenceDigest, challenge: pending.challenge }) }
      catch (cause) {
        this.closed = "audit write failed"
        if (this.admitting !== null) this.releaseAdmission(this.admitting)
        this.admitting = null
        throw new Error("Cannot record approval request", { cause })
      }
      if (this.closed !== null || this.admitting?.raw !== candidate.raw) {
        throw new Error(`Approval ceremony closed: ${this.closed === null ? "admission changed" : this.closed}`)
      }
      this.current = pending
      this.admitting = null
      try {
        pending.cancelExpiry = this.options.schedule(() => {
          if (this.current === pending) this.closePending("approval expired")
        }, this.options.approvalMs)
      } catch (cause) {
        this.failBeforeSend(pending, "approval timer failed")
        throw new Error("Cannot start approval deadline", { cause })
      }
    }
    const pending = this.current !== null ? this.current : this.transmitting
    if (!pending) throw new Error("Approval state changed before waiter registration")
    if (pending.waiters.size >= this.options.maxWaiters) throw new Error("Too many approval waiters")
    return new Promise<SubmissionResult>((resolve, reject) => {
      const waiter: Waiter = { resolve }
      if (signal) {
        waiter.signal = signal
        waiter.onAbort = () => {
          pending.waiters.delete(waiter)
          reject(new Error("Approval waiter disconnected"))
          if (pending.waiters.size === 0 && this.current === pending) this.closePending("all approval waiters disconnected")
        }
        signal.addEventListener("abort", waiter.onAbort, { once: true })
      }
      pending.waiters.add(waiter)
      if (signal?.aborted) waiter.onAbort?.()
    })
  }

  async decide(challenge: string, decision: "approve" | "reject"): Promise<void> {
    const pending = this.current
    if (!pending || pending.challenge !== challenge) throw new Error("Approval challenge is stale")
    if (this.options.now() >= pending.deadline) {
      this.closePending("approval expired")
      throw new Error("Approval expired")
    }
    if (decision === "reject") { this.closePending("operator rejected"); return }
    try { this.options.audit.append({ kind: "approved", hash: pending.hash, challenge }) }
    catch (cause) { this.failBeforeSend(pending, "audit write failed"); throw cause }
    if (this.current !== pending || this.options.now() >= pending.deadline || pending.waiters.size === 0) {
      this.closePending("approval expired or canceled")
      throw new Error("Approval expired or canceled before submission")
    }
    try { this.options.audit.append({ kind: "transmitting", hash: pending.hash }) }
    catch (cause) { this.failBeforeSend(pending, "audit write failed"); throw cause }
    if (this.current !== pending || this.options.now() >= pending.deadline || pending.waiters.size === 0 || this.closed !== null) {
      if (this.current === pending) this.closePending("approval expired or canceled")
      throw new Error("Approval expired or canceled before submission")
    }
    this.current = null
    pending.cancelExpiry()
    this.transmitting = pending
    this.transmissionDone = new Promise<void>(resolve => { this.finishTransmission = resolve })
    let outcome: SubmissionResult
    try {
      const returned = await this.options.send(pending.raw)
      outcome = returned.toLowerCase() === pending.hash ? { status: "accepted", hash: pending.hash } :
        { status: "uncertain", hash: pending.hash, reason: "provider returned a different transaction hash" }
    } catch (error) {
      outcome = { status: "uncertain", hash: pending.hash, reason: `upstream result unknown (${safeErrorClass(error)})` }
    }
    try {
      this.options.audit.append(outcome.status === "accepted" ? { kind: "accepted", hash: pending.hash } :
        { kind: "uncertain", hash: pending.hash, reason: outcome.reason })
    } catch {
      outcome = { status: "uncertain", hash: pending.hash, reason: "cannot persist upstream result" }
    }
    if (outcome.status === "accepted") {
      try { await this.options.accepted(pending.hash) }
      catch (error) {
        outcome = { status: "accepted", hash: pending.hash, continuationFailure: safeErrorClass(error) }
        if (this.closed === null) this.closed = "accepted continuation failed"
      }
    } else {
      const cleanupFailure = this.releaseReservation(pending.hash)
      if (cleanupFailure !== null) outcome = { ...outcome, reason: `${outcome.reason}; ${cleanupFailure}` }
    }
    this.outcomes.set(pending.hash, outcome)
    if (outcome.status === "uncertain") this.closed = outcome.reason
    this.transmitting = null
    this.resolve(pending, outcome)
    this.finishTransmission?.()
    this.finishTransmission = null
    this.transmissionDone = null
  }

  private async admit(candidate: Candidate, signal?: AbortSignal): Promise<void> {
    let admission = this.admitting
    if (admission !== null && admission.raw !== candidate.raw) throw new Error("Another candidate is being inspected")
    if (admission === null) {
      admission = { ...candidate, waiters: 0, canceled: false, completed: false, released: false, inspection: Promise.resolve(null) }
      const started = admission
      started.inspection = Promise.resolve().then(() => this.options.inspect(candidate.raw)).then(
        () => { started.completed = true; if (started.canceled) this.releaseAdmission(started); return null },
        error => {
          started.completed = true
          this.closed = "transaction inspection failed"
          const cleanupFailure = this.releaseAdmission(started)
          const reason = `Transaction inspection failed (${safeErrorClass(error)})`
          return new Error(cleanupFailure === null ? reason : `${reason}; ${cleanupFailure}`)
        },
      )
      this.admitting = started
    }
    if (admission.waiters >= this.options.maxWaiters) throw new Error("Too many approval admission waiters")
    admission.waiters++
    let admitted = false
    try {
      const result = signal ? await this.waitForAdmission(admission.inspection, signal) : await admission.inspection
      if (result !== null) throw result
      if (admission.canceled) throw new Error(`Approval admission canceled: ${this.closed === null ? "closed" : this.closed}`)
      admitted = true
    } finally {
      admission.waiters--
      if (admission.waiters === 0 && this.admitting === admission) {
        if (!admitted || admission.canceled) {
          admission.canceled = true
          if (this.closed === null) this.closed = "all approval waiters disconnected"
          if (admission.completed) this.releaseAdmission(admission)
          this.admitting = null
        }
      }
    }
  }

  private waitForAdmission(inspection: Promise<Error | null>, signal: AbortSignal): Promise<Error | null> {
    if (signal.aborted) return Promise.reject(new Error("Approval waiter disconnected"))
    return new Promise((resolve, reject) => {
      const onAbort = () => { signal.removeEventListener("abort", onAbort); reject(new Error("Approval waiter disconnected")) }
      signal.addEventListener("abort", onAbort, { once: true })
      inspection.then(value => { signal.removeEventListener("abort", onAbort); resolve(value) })
    })
  }

  private releaseReservation(hash: Hex): string | null {
    try { this.options.notAccepted(hash) }
    catch { this.closed = "verifier reservation cleanup failed"; return this.closed }
    return null
  }

  private releaseAdmission(admission: Admission): string | null {
    if (admission.released) return null
    admission.released = true
    return this.releaseReservation(admission.hash)
  }

  close(reason: string): void {
    if (this.closed !== null) return
    if (this.current) { this.closePending(reason); return }
    this.closed = reason
    if (this.admitting) {
      this.admitting.canceled = true
      if (this.admitting.completed) this.releaseAdmission(this.admitting)
    }
    this.options.audit.append({ kind: "closed", reason })
  }

  private failBeforeSend(pending: Pending, reason: string) {
    this.current = null
    pending.cancelExpiry()
    this.closed = reason
    const cleanupFailure = this.releaseReservation(pending.hash)
    if (cleanupFailure !== null) reason = `${reason}; ${cleanupFailure}`
    this.resolve(pending, { status: "refused", hash: pending.hash, reason })
  }

  private closePending(reason: string): void {
    const pending = this.current
    if (!pending) return
    this.current = null
    pending.cancelExpiry()
    this.closed = reason
    try { this.options.audit.append({ kind: "closed", hash: pending.hash, reason }) }
    catch { reason = "audit write failed"; this.closed = reason }
    const cleanupFailure = this.releaseReservation(pending.hash)
    if (cleanupFailure !== null) reason = `${reason}; ${cleanupFailure}`
    const outcome: SubmissionResult = { status: "refused", hash: pending.hash, reason }
    this.outcomes.set(pending.hash, outcome)
    this.resolve(pending, outcome)
  }

  private resolve(pending: Pending, outcome: SubmissionResult) {
    for (const waiter of pending.waiters) {
      if (waiter.signal && waiter.onAbort) waiter.signal.removeEventListener("abort", waiter.onAbort)
      waiter.resolve(outcome)
    }
    pending.waiters.clear()
  }
}
