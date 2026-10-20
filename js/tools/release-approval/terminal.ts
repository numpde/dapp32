import type { Readable, Writable } from "node:stream"
import type { Hex } from "viem"

import type { ApprovalOwner } from "./owner.ts"
import type { TransactionReview } from "./verifier.ts"

type TtyInput = Readable & { isTTY?: boolean }
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

function fullDetails(review: TransactionReview, referenceName: string): string {
  const args = review.comparison.expectedArgs.map((value, index) => `  ${index + 1}: ${visible(value)}`).join("\n")
  if (review.signed.accessList !== undefined && !Array.isArray(review.signed.accessList)) {
    throw new Error("Signed access list is not an array")
  }
  const accessList = review.signed.accessList === undefined ? "[]" : JSON.stringify(review.signed.accessList)
  return [
    `Reference name: ${visible(referenceName)}`,
    `Reference step: ${review.stepIndex + 1} ${visible(review.step.name)} (${review.step.kind})`,
    `Contract role: ${visible(review.step.role)}`,
    `ABI signature: ${review.step.signature === undefined ? "constructor" : visible(review.step.signature)}`,
    `Expected arguments:\n${args}`,
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
  private deciding = false
  private lineBuffer = ""
  private displayed: { hash: Hex; challenge: string; details: string } | null = null

  constructor(options: ApprovalTerminalOptions) {
    if (!Number.isSafeInteger(options.pageCharacters) || options.pageCharacters < 128 || options.pageCharacters > 4096) {
      throw new Error("Terminal inspection page size must be between 128 and 4096 characters")
    }
    this.options = options
  }

  start(): void {
    if (this.started) throw new Error("Approval terminal already started")
    if (this.options.input.isTTY !== true || this.options.output.isTTY !== true) {
      throw new Error("Approval requires an attached operator TTY")
    }
    this.started = true
    this.options.input.on("data", this.onData)
    this.options.input.on("end", this.onDetach)
    this.options.input.on("close", this.onDetach)
    this.options.input.on("error", this.onDetach)
    this.options.output.on("error", this.onDetach)
    this.options.output.on("close", this.onDetach)
  }

  stop(): void {
    if (!this.started) return
    this.started = false
    this.options.input.off("data", this.onData)
    this.options.input.off("end", this.onDetach)
    this.options.input.off("close", this.onDetach)
    this.options.input.off("error", this.onDetach)
    this.options.output.off("error", this.onDetach)
    this.options.output.off("close", this.onDetach)
    this.displayed = null
  }

  poll(): void {
    if (!this.started || this.closed || this.deciding) return
    const pending = this.options.owner.pending()
    if (pending === null) { this.displayed = null; return }
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
      details = fullDetails(review, this.options.referenceName)
      ceiling = exactDecimal(review.signed.gasLimit, "gas limit") * exactDecimal(review.signed.maxFeePerGasWei, "maximum fee per gas")
      if (details.length > 1_048_576) throw new Error("Transaction details exceed display limit")
    } catch {
      this.fail("transaction details cannot be displayed safely")
      return
    }
    this.displayed = { hash: pending.hash, challenge: pending.challenge, details }
    this.writeSummary(pending, review, ceiling, details.length)
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
      return `    ${index + 1}${role}: ${short(value)}`
    })
    if (comparison.expectedArgs.length > 4) argumentLines.push(`    ${comparison.expectedArgs.length - 4} more; inspect full data`)
    this.write([
      `\nReview transaction ${review.stepIndex + 1}`,
      "Signed transaction",
      `  Chain ID: ${signed.chainId}`,
      `  Sender: ${signed.sender}`,
      `  Target: ${signed.to === null ? "contract creation" : signed.to}`,
      `  Type: EIP-1559 (0x02)` ,
      `  Nonce: ${signed.nonce}`,
      `  Native value: ${signed.valueWei} wei`,
      `  Gas limit: ${signed.gasLimit}`,
      `  Maximum fee per gas: ${signed.maxFeePerGasWei} wei`,
      `  Priority fee cap: ${signed.maxPriorityFeePerGasWei} wei`,
      `  Execution fee ceiling: ${ceiling} wei (gas limit x maximum fee per gas)`,
      "  Other chain fees: not established",
      `  Calldata: ${(signed.calldata.length - 2) / 2} bytes; Keccak-256 ${signed.calldataHash}`,
      `  Transaction hash: ${signed.hash}`,
      "Reference comparison",
      `  Selected reference: ${short(this.options.referenceName)}; digest ${pending.referenceDigest}`,
      `  Step: ${short(review.step.name)}; role ${short(review.step.role)}`,
      `  ABI: ${review.step.signature === undefined ? "constructor" : short(review.step.signature)}`,
      `  Target role/address: ${comparison.targetRole === null ? "contract creation" : short(comparison.targetRole)} / ${comparison.targetAddress === null ? "n/a" : comparison.targetAddress}`,
      ...(review.step.kind === "create" ? [`  Predicted creation address: ${comparison.predictedAddress}`] : []),
      `  Artifact SHA-256: ${comparison.artifactSha256}`,
      "  Arguments matched against signed calldata:",
      ...(argumentLines.length === 0 ? ["    none"] : argumentLines),
      `  Approval closes in ${seconds} seconds`,
      `  Inspect full data: inspect ${pending.challenge} <page 1-${pages}>`,
      `  Approve with: approve ${pending.challenge}`,
      `  Reject with: reject ${pending.challenge}`,
      "",
    ].join("\n"))
  }

  private readonly onData = (chunk: Buffer | string): void => {
    if (this.closed) return
    this.lineBuffer += typeof chunk === "string" ? chunk : chunk.toString("utf8")
    for (;;) {
      const end = this.lineBuffer.indexOf("\n")
      if (end < 0) {
        if (this.lineBuffer.length > 256) this.fail("operator command exceeds 256 characters")
        break
      }
      if (end > 256) { this.fail("operator command exceeds 256 characters"); return }
      const line = this.lineBuffer.slice(0, end).replace(/\r$/, "")
      this.lineBuffer = this.lineBuffer.slice(end + 1)
      this.onLine(line)
      if (this.closed) return
    }
  }

  private onLine(line: string): void {
    if (this.deciding) { this.write("Decision in progress; input ignored.\n"); return }
    const displayed = this.displayed
    const pending = this.options.owner.pending()
    if (displayed === null || pending === null || pending.hash !== displayed.hash || pending.challenge !== displayed.challenge) {
      this.displayed = null
      this.write("No current approval prompt.\n")
      return
    }
    const approval = /^(approve|reject) ([a-zA-Z0-9-]+)$/.exec(line)
    if (approval !== null) {
      if (approval[2] !== displayed.challenge) { this.write("Challenge does not match this transaction.\n"); return }
      this.deciding = true
      this.displayed = null
      void this.options.owner.decide(displayed.challenge, approval[1] as "approve" | "reject").then(
        () => { this.deciding = false },
        () => { this.deciding = false; this.write("Decision failed; check approval status before continuing.\n") },
      )
      return
    }
    const inspect = /^inspect ([a-zA-Z0-9-]+) ([1-9][0-9]*)$/.exec(line)
    if (inspect !== null && inspect[1] === displayed.challenge) {
      const page = Number(inspect[2])
      const count = Math.ceil(displayed.details.length / this.options.pageCharacters)
      if (!Number.isSafeInteger(page) || page > count) { this.write(`Page must be between 1 and ${count}.\n`); return }
      const start = (page - 1) * this.options.pageCharacters
      this.write(`Full data page ${page} of ${count}\n${displayed.details.slice(start, start + this.options.pageCharacters)}\n`)
      return
    }
    this.write("Enter the displayed approve, reject, or inspect command with its current challenge.\n")
  }

  private readonly onDetach = (): void => { this.fail("operator terminal detached") }

  private fail(reason: string): void {
    if (this.closed) return
    this.closed = true
    this.stop()
    this.options.owner.close(reason)
  }

  private write(value: string): void {
    if (this.closed) return
    try {
      if (!this.options.output.write(value)) this.fail("operator terminal output blocked")
    } catch {
      this.fail("operator terminal output failed")
    }
  }
}
