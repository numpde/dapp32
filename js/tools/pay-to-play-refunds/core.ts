// Bounded, retryable refund batches. The chain, not an offchain success list,
// decides whether a position is still due (or belongs to a later funding cycle).
export type Address = `0x${string}`
export type Hex = `0x${string}`
export class RefundWorkerError extends Error {}
export interface Position {
  balance: bigint
  scheduledRefundAt: bigint
  requestedAmount: bigint
  refundAt: bigint
  refundRecipient: Address
  phase: number
}
export type Report = (entry: Record<string, string | number | boolean>) => void
export type SendResult =
  | { status: "confirmed" | "reverted" | "pending"; hash: Hex }
  | { status: "simulation_failed" }
export interface RefundAdapter {
  readPosition(customer: Address): Promise<Position>
  sendRefund(customer: Address): Promise<SendResult>
}
export interface BatchOptions {
  execute: boolean
  maxTransactions: number
  report: Report
}

export function isRefundDue(position: Position): boolean {
  return position.phase === 2 && position.refundAt !== 0n
    && (position.balance !== 0n || position.scheduledRefundAt !== 0n || position.requestedAmount !== 0n)
}

export async function runRefundBatch(customers: readonly Address[], adapter: RefundAdapter, options: BatchOptions) {
  if (!Number.isSafeInteger(options.maxTransactions) || options.maxTransactions < 1 || options.maxTransactions > 100) {
    throw new RefundWorkerError("maxTransactions must be between 1 and 100")
  }
  if (customers.length > 1000) throw new RefundWorkerError("Too many customers; narrow the discovery interval")
  const summary = { inspected: 0, due: 0, confirmed: 0, failed: 0, submitted: 0, deferred: 0, pending: false }
  // Deduplicate even operator-supplied input; never count a duplicate as work.
  const unique = [...new Set(customers.map(customer => customer.toLowerCase() as Address))].sort()
  for (const customer of unique) {
    let position: Position
    try {
      position = await adapter.readPosition(customer)
    } catch {
      summary.failed++
      options.report({ event: "read_failed", customer })
      continue
    }
    summary.inspected++
    if (!isRefundDue(position)) {
      options.report({ event: "not_due", customer })
      continue
    }
    summary.due++
    options.report({ event: "due", customer, balance: position.balance.toString(), recipient: position.refundRecipient, refundAt: position.refundAt.toString() })
    if (!options.execute) continue
    if (summary.submitted >= options.maxTransactions) {
      summary.deferred++
      continue
    }
    // The adapter must durably record the signed transaction hash BEFORE
    // broadcast and must not retry an ambiguous broadcast with a new nonce.
    // Unexpected errors propagate, rather than continuing after uncertain state.
    const result = await adapter.sendRefund(customer)
    if (result.status === "simulation_failed") {
      summary.failed++
      options.report({ event: result.status, customer })
      continue
    }
    summary.submitted++
    options.report({ event: result.status, customer, hash: result.hash })
    if (result.status === "pending") {
      summary.pending = true
      break
    }
    if (result.status === "confirmed") summary.confirmed++
    else summary.failed++
  }
  options.report({ event: "batch", ...summary, execute: options.execute })
  return summary
}

export interface DiscoveryOptions {
  fromBlock: bigint
  toBlock: bigint
  blockChunk: number
  maxCustomers: number
}

export async function discoverCustomers(
  readPage: (fromBlock: bigint, toBlock: bigint) => Promise<readonly Address[]>,
  options: DiscoveryOptions,
): Promise<Address[]> {
  const { fromBlock, toBlock, blockChunk, maxCustomers } = options
  if (fromBlock < 0n || toBlock < fromBlock || toBlock - fromBlock >= 100_000n) {
    throw new RefundWorkerError("Discovery must cover 1 to 100000 blocks")
  }
  if (!Number.isSafeInteger(blockChunk) || blockChunk < 1 || blockChunk > 10_000) throw new RefundWorkerError("Invalid blockChunk")
  if (!Number.isSafeInteger(maxCustomers) || maxCustomers < 1 || maxCustomers > 1000) throw new RefundWorkerError("Invalid maxCustomers")
  const customers = new Set<Address>()
  for (let from = fromBlock; from <= toBlock; from += BigInt(blockChunk)) {
    const end = from + BigInt(blockChunk) - 1n
    const to = end < toBlock ? end : toBlock
    const page = await readPage(from, to)
    if (page.length > 10_000) throw new RefundWorkerError("Too many events in a page; reduce blockChunk")
    for (const raw of page) {
      if (!/^0x[0-9a-fA-F]{40}$/.test(raw) || /^0x0{40}$/i.test(raw)) throw new RefundWorkerError("Invalid event customer")
      customers.add(raw.toLowerCase() as Address)
      if (customers.size > maxCustomers) throw new RefundWorkerError("Customer limit exceeded; narrow the discovery interval")
    }
  }
  return [...customers].sort()
}
