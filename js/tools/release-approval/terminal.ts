import type { Readable, Writable } from "node:stream"
import type { Hex } from "viem"

import type { ApprovalOwner, AuditEvent } from "./owner.ts"
import type { TransactionReview } from "./verifier.ts"

type TtyInput = Readable & { isTTY?: boolean; isRaw?: boolean; setRawMode?: (enabled: boolean) => unknown }
type TtyOutput = Writable & { isTTY?: boolean }
type Pending = NonNullable<ReturnType<ApprovalOwner["pending"]>>

export type ApprovalTerminalOptions = {
  input: TtyInput
  output: TtyOutput
  owner: Pick<ApprovalOwner, "pending" | "decide" | "close">
  reviewForHash: (hash: Hex) => TransactionReview | null
  referenceName: string
  now: () => number
  pageCharacters: number
}

// Render untrusted reference text as printable ASCII. Escaping every non-ASCII
// code unit also makes bidi and terminal-control characters unambiguous.
function visible(value: string): string {
  let result = ""
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index)
    result += code >= 0x20 && code <= 0x7e && code !== 0x5c ? value[index] :
      code === 0x5c ? "\\\\" : `\\u${code.toString(16).padStart(4, "0")}`
  }
  return result
}

function short(value: string): string {
  const limit = 100
  const rendered = visible(value)
  return rendered.length <= limit ? rendered : `${rendered.slice(0, limit)}... [full value in inspect pages]`
}

function exactDecimal(value: string, label: string): bigint {
  if (!/^(?:0|[1-9][0-9]*)$/.test(value)) throw new Error(`${label} is not a canonical nonnegative integer`)
  return BigInt(value)
}

function fullDetails(review: TransactionReview, referenceName: string, referenceDigest: Hex): string {
  const args = review.comparison.expectedArgs.map((value, index) => `  ${index + 1} ${visible(review.step.argumentLabels[index])}: ${visible(value)}`).join("\n")
  if (review.signed.accessList !== undefined && !Array.isArray(review.signed.accessList)) {
    throw new Error("Signed access list is not an array")
  }
  const accessList = review.signed.accessList === undefined ? "[]" : JSON.stringify(review.signed.accessList)
  return [
    `Reference name: ${visible(referenceName)}`,
    `Reference SHA-256: ${referenceDigest}`,
    `Reference step: ${review.stepIndex + 1} ${visible(review.step.name)} (${review.step.kind})`,
    `Action: ${visible(review.step.action)}`,
    `Contract role: ${visible(review.step.role)}`,
    `ABI signature: ${review.step.signature === undefined ? "constructor" : visible(review.step.signature)}`,
    `Expected arguments:\n${args}`,
    `Chain ID: ${review.signed.chainId}`,
    `Sender: ${review.signed.sender}`,
    `Nonce: ${review.signed.nonce}`,
    `Native value: ${review.signed.valueWei} wei`,
    `Transaction hash: ${review.signed.hash}`,
    "Type: EIP-1559 (0x02)",
    `Gas limit: ${review.signed.gasLimit}`,
    `Maximum fee per gas: ${review.signed.maxFeePerGasWei} wei`,
    `Priority fee cap: ${review.signed.maxPriorityFeePerGasWei} wei`,
    "Execution fee ceiling: gas limit x maximum fee per gas; other chain fees are not established",
    `Calldata: ${(review.signed.calldata.length - 2) / 2} bytes; Keccak-256 ${review.signed.calldataHash}`,
    `Artifact SHA-256: ${review.comparison.artifactSha256}`,
    `Compiler metadata SHA-256: ${review.comparison.compilerMetadataSha256}`,
    `Target role: ${review.comparison.targetRole === null ? "none" : visible(review.comparison.targetRole)}`,
    `Target address: ${review.comparison.targetAddress === null ? "contract creation" : review.comparison.targetAddress}`,
    `Creation bytecode comparison: ${review.comparison.creationBytecodeMatched === null ? "not applicable" : review.comparison.creationBytecodeMatched ? "matched" : "mismatched"}`,
    `Predicted creation address: ${review.comparison.predictedAddress === null ? "not applicable" : review.comparison.predictedAddress}`,
    `Access list: ${visible(accessList)}`,
    `Actual calldata: ${review.signed.calldata}`,
    `Expected calldata: ${review.comparison.expectedCalldata}`,
  ].join("\n")
}

export class ApprovalTerminal {
  private readonly options: ApprovalTerminalOptions
  private started = false
  private closed = false
  private deciding: { hash: Hex; transaction: number } | null = null
  private previousRaw = false
  private ready = false
  private sequence = ""
  private pasteTail: string | null = null
  private mouseBytes = 0
  private page: number | null = null
  private displayed: { hash: Hex; challenge: string; details: string; review: TransactionReview; ceiling: bigint } | null = null

  constructor(options: ApprovalTerminalOptions) {
    if (!Number.isSafeInteger(options.pageCharacters) || options.pageCharacters < 128 || options.pageCharacters > 4096) {
      throw new Error("Terminal inspection page size must be between 128 and 4096 characters")
    }
    this.options = options
  }

  start(): void {
    if (this.started) throw new Error("Approval terminal already started")
    if (this.options.input.isTTY !== true || this.options.output.isTTY !== true || typeof this.options.input.setRawMode !== "function") {
      throw new Error("Approval requires an attached operator TTY")
    }
    this.previousRaw = this.options.input.isRaw === true
    this.options.input.setRawMode(true)
    this.started = true
    this.options.input.on("data", this.onData)
    this.options.input.on("end", this.onDetach)
    this.options.input.on("close", this.onDetach)
    this.options.input.on("error", this.onDetach)
    this.options.output.on("error", this.onDetach)
    this.options.output.on("close", this.onDetach)
    this.write("\u001b[?2004h")
  }

  stop(): void {
    if (!this.started) return
    this.started = false
    this.ready = false
    try {
      this.options.input.setRawMode!(this.previousRaw)
    } finally {
      this.options.input.off("data", this.onData)
      this.options.input.off("end", this.onDetach)
      this.options.input.off("close", this.onDetach)
      this.options.input.off("error", this.onDetach)
      if (!this.options.output.destroyed) {
        try { this.options.output.write("\u001b[?2004l") } catch { /* input restoration and cleanup still complete */ }
      }
      // A failed final write can emit its error on the next stream turn.
      setImmediate(() => this.options.output.off("error", this.onDetach))
      this.options.output.off("close", this.onDetach)
      this.displayed = null
    }
  }

  poll(): void {
    if (!this.started || this.closed || this.deciding) return
    const pending = this.options.owner.pending()
    if (pending === null) { this.displayed = null; this.ready = false; return }
    if (this.displayed?.hash === pending.hash && this.displayed.challenge === pending.challenge) return
    const review = this.options.reviewForHash(pending.hash)
    if (review === null || review.signed.hash !== pending.hash || review.signed.sender !== pending.sender ||
        review.signed.chainId !== pending.chainId || review.signed.nonce !== pending.nonce ||
        (review.step.kind === "create" && review.comparison.predictedAddress === null)) {
      this.fail("verified transaction details do not match pending approval")
      return
    }
    let details: string
    let ceiling: bigint
    try {
      details = fullDetails(review, this.options.referenceName, pending.referenceDigest)
      ceiling = exactDecimal(review.signed.gasLimit, "gas limit") * exactDecimal(review.signed.maxFeePerGasWei, "maximum fee per gas")
      if (details.length > 1_048_576) throw new Error("Transaction details exceed display limit")
    } catch {
      this.fail("transaction details cannot be displayed safely")
      return
    }
    this.ready = false
    this.page = null
    this.discardInput()
    this.displayed = { hash: pending.hash, challenge: pending.challenge, details, review, ceiling }
    this.writeSummary(pending, review, ceiling, details.length)
  }

  /** Display persisted submission facts for the current decision; RPC acceptance is not mining. */
  reportSubmission(event: AuditEvent): void {
    const decision = this.deciding
    if (!this.started || this.closed || decision === null) return
    if (event.kind !== "transmitting" && event.kind !== "accepted" && event.kind !== "uncertain") return
    if (event.hash !== decision.hash) return
    const transaction = `Transaction ${decision.transaction} (${event.hash})`
    if (event.kind === "transmitting") this.write(`${transaction}: approval recorded; preparing submission...\n`)
    else if (event.kind === "accepted") this.write(`${transaction}: RPC accepted. Waiting for a mined receipt...\n`)
    else this.write(`${transaction}: submission result unknown. Deployment will stop; check transaction status before resubmitting.\n`)
  }

  private writeSummary(pending: Pending, review: TransactionReview, ceiling: bigint, detailLength: number): void {
    const signed = review.signed
    const comparison = review.comparison
    const pages = Math.max(1, Math.ceil(detailLength / this.options.pageCharacters))
    const seconds = Math.max(0, Math.ceil((pending.deadline - this.options.now()) / 1000))
    const argumentLines = comparison.expectedArgs.slice(0, 4).map((value, index) => {
      const from = review.step.args[index]
      const role = typeof from === "object" && from !== null && "createdContract" in from ?
        ` (${short(from.createdContract)} contract)` : ""
      const identity = /^0x[0-9a-fA-F]{40}$/.test(value) && value.toLowerCase() === signed.sender.toLowerCase() ? " (deployment account)" : ""
      return `    ${index + 1} ${short(review.step.argumentLabels[index])}${role}: ${short(value)}${identity}`
    })
    if (comparison.expectedArgs.length > 4) argumentLines.push(`    ${comparison.expectedArgs.length - 4} more; inspect full data`)
    this.write([
      `\nReview transaction ${review.stepIndex + 1}`,
      `Action: ${short(review.step.action)}`,
      `  Chain ID: ${signed.chainId}`,
      `  Sender: ${signed.sender}`,
      `  Target: ${signed.to === null ? "contract creation" : `${signed.to} (${short(review.step.role)} contract)`}`,
      `  Step: ${short(review.step.name)}; contract ${short(review.step.role)}`,
      `  Nonce: ${signed.nonce}`,
      `  Native value: ${signed.valueWei} wei`,
      `  Execution fee ceiling: ${ceiling} wei`,
      "  Other chain fees: not established",
      `  Transaction hash: ${signed.hash}`,
      "  Arguments matched against signed calldata:",
      ...(argumentLines.length === 0 ? ["    none"] : argumentLines),
      `  Decision timeout: ${seconds} seconds (cancels remaining deployment)`,
      `  Full data: ${pages} pages; i inspect/back, n next, p previous`,
      "  Press a to approve and send, r to reject and stop. No Enter for any key.",
      "",
    ].join("\n"), () => {
      if (this.displayed?.hash === pending.hash && this.displayed.challenge === pending.challenge) {
        this.discardInput()
        this.ready = true
      }
    })
  }

  private readonly onData = (chunk: Buffer | string): void => {
    if (this.closed) return
    const bytes = typeof chunk === "string" ? Buffer.from(chunk, "utf8") : chunk
    // Escape/paste filtering follows ops-doctor approval.py key() at 788b22eb.
    // Packets are not physical key boundaries. Combined input is discarded,
    // while sequence state spans packets so split paste/escape input stays inert.
    for (const byte of bytes) {
      if (byte === 3) {
        this.fail("operator interrupted approval")
        return
      }
      const character = String.fromCharCode(byte)
      if (this.pasteTail !== null) {
        this.pasteTail = (this.pasteTail + character).slice(-6)
        if (this.pasteTail === "\u001b[201~") this.pasteTail = null
      } else if (this.mouseBytes > 0) {
        this.mouseBytes--
      } else if (this.sequence !== "") {
        this.sequence = (this.sequence.length < 64 ? this.sequence : this.sequence.slice(0, 2) + this.sequence.slice(-61)) + character
        const introducer = this.sequence[1]
        if (introducer === "[" || introducer === "O") {
          if (this.sequence.length > 2 && byte >= 64 && byte <= 126) {
            if (this.sequence === "\u001b[200~") this.pasteTail = ""
            else if (this.sequence === "\u001b[M") this.mouseBytes = 3
            this.sequence = ""
          }
        } else if (introducer === "]" || introducer === "P" || introducer === "^" || introducer === "_") {
          if ((introducer === "]" && byte === 7) || this.sequence.endsWith("\u001b\\")) this.sequence = ""
        } else this.sequence = ""
      } else if (byte === 27) {
        this.sequence = "\u001b"
      } else if (bytes.length === 1) {
        this.onKey(character)
      }
    }
  }

  private onKey(key: string): void {
    if (!this.ready || this.deciding) return
    const displayed = this.displayed
    const pending = this.options.owner.pending()
    if (displayed === null || pending === null || pending.hash !== displayed.hash || pending.challenge !== displayed.challenge) {
      this.displayed = null
      this.ready = false
      return
    }
    if (key === "a" || key === "r") {
      const transaction = displayed.review.stepIndex + 1
      this.deciding = { hash: displayed.hash, transaction }
      this.ready = false
      this.displayed = null
      this.discardInput()
      const feedback = key === "a" ? `Approval key received for transaction ${transaction}. Recording decision...\n` :
        `Rejection key received for transaction ${transaction}. Stopping deployment...\n`
      const decide = () => {
        if (!this.started || this.closed) return
        void this.options.owner.decide(displayed.challenge, key === "a" ? "approve" : "reject").then(
          () => { this.discardInput(); this.deciding = null },
          () => { this.discardInput(); this.deciding = null; this.write("Decision failed; check approval status before continuing.\n") },
        )
      }
      // Approval waits for visible acknowledgment; rejection must not wait for output.
      if (key === "a") this.write(feedback, decide)
      else { this.write(feedback); decide() }
      return
    }
    const count = Math.ceil(displayed.details.length / this.options.pageCharacters)
    if (key === "i") {
      this.page = this.page === null ? 0 : null
      if (this.page === null) {
        this.ready = false
        this.writeSummary(pending, displayed.review, displayed.ceiling, displayed.details.length)
        return
      }
    } else if (key === "n" && this.page !== null) this.page = Math.min(count - 1, this.page + 1)
    else if (key === "p" && this.page !== null) this.page = Math.max(0, this.page - 1)
    else return
    if (this.page !== null) {
      this.ready = false
      const start = this.page * this.options.pageCharacters
      this.write(`Full data page ${this.page + 1} of ${count}\n${displayed.details.slice(start, start + this.options.pageCharacters)}\n` +
        "a approve and send; r reject and stop; n next; p previous; i back. No Enter.\n", () => {
          if (this.displayed === displayed) this.ready = true
        })
    }
  }

  private discardInput(): void {
    while (this.options.input.read() !== null) { /* discard bytes buffered for the previous prompt */ }
  }

  private readonly onDetach = (): void => { this.fail("operator terminal detached") }

  private fail(reason: string): void {
    if (this.closed) return
    this.closed = true
    try { this.stop() } finally { this.options.owner.close(reason) }
  }

  private write(value: string, onFlushed?: () => void): void {
    if (this.closed) return
    let accepted = false
    let flushed = false
    try {
      accepted = this.options.output.write(value, error => {
        if (error) { this.fail("operator terminal output failed"); return }
        flushed = true
        if (accepted && !this.closed) onFlushed?.()
      })
      if (!accepted) this.fail("operator terminal output blocked")
      else if (flushed) onFlushed?.()
    } catch {
      this.fail("operator terminal output failed")
    }
  }
}
