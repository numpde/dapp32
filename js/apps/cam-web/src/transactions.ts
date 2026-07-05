export type SubmittedTransaction = {
  readonly blockNumber: bigint | null
  readonly from: `0x${string}`
  readonly nonce: number
}

export type TransactionReader<TReceipt> = {
  readonly getTransaction: (args: { readonly hash: `0x${string}` }) => Promise<SubmittedTransaction>
  readonly getTransactionCount: (args: {
    readonly address: `0x${string}`
    readonly blockTag: "pending"
  }) => Promise<number>
  readonly waitForTransactionReceipt: (args: {
    readonly hash: `0x${string}`
    readonly pollingInterval: number
    readonly timeout: number
  }) => Promise<TReceipt>
}

export async function waitForSubmittedTransactionReceipt<TReceipt>({
  client,
  txHash,
  rpcEndpoint,
  pollingIntervalMs,
  timeoutMs,
}: {
  readonly client: TransactionReader<TReceipt>
  readonly txHash: `0x${string}`
  readonly rpcEndpoint: string
  readonly pollingIntervalMs: number
  readonly timeoutMs: number
}): Promise<TReceipt> {
  try {
    return await client.waitForTransactionReceipt({
      hash: txHash,
      pollingInterval: pollingIntervalMs,
      timeout: timeoutMs,
    })
  } catch (cause) {
    const diagnosis = await submittedTransactionDiagnosis({
      client,
      txHash,
      rpcEndpoint,
      includePendingAdvice: true,
    })
    throw new Error(
      [
        `Transaction was sent, but the viewer did not see a receipt on ${rpcEndpoint} within ${timeoutMs / 1000}s.`,
        receiptTimeoutAdvice(diagnosis),
      ].join(" "),
      { cause },
    )
  }
}

export async function submittedTransactionDiagnosis({
  client,
  txHash,
  rpcEndpoint,
  includePendingAdvice,
}: {
  readonly client: Pick<TransactionReader<unknown>, "getTransaction" | "getTransactionCount">
  readonly txHash: `0x${string}`
  readonly rpcEndpoint: string
  readonly includePendingAdvice: boolean
}): Promise<string | undefined> {
  const tx = await readSubmittedTransaction(client, txHash, rpcEndpoint)
  if (tx.blockNumber !== null) return undefined

  const pendingNonce = await client.getTransactionCount({
    address: tx.from,
    blockTag: "pending",
  })
  if (tx.nonce > pendingNonce) {
    return nonceGapMessage(tx.nonce, pendingNonce)
  }
  if (!includePendingAdvice) {
    return undefined
  }

  return tx.nonce === pendingNonce
    ? `The transaction is known by the local RPC but is still pending at nonce ${tx.nonce}. Check whether local mining is paused or the wallet left the transaction in the mempool.`
    : `The transaction nonce ${tx.nonce} is lower than the local pending nonce ${pendingNonce}. The wallet may have shown a stale or replaced transaction hash.`
}

async function readSubmittedTransaction(
  client: Pick<TransactionReader<unknown>, "getTransaction">,
  txHash: `0x${string}`,
  rpcEndpoint: string,
): Promise<SubmittedTransaction> {
  try {
    return await client.getTransaction({ hash: txHash })
  } catch (cause) {
    throw new Error(
      `The wallet returned a transaction hash, but the viewer could not read that transaction from ${rpcEndpoint}.`,
      { cause },
    )
  }
}

function receiptTimeoutAdvice(diagnosis: string | undefined): string {
  if (diagnosis !== undefined) {
    return diagnosis
  }

  return "Check that the wallet is using the same local RPC as the viewer."
}

function nonceGapMessage(txNonce: number, pendingNonce: number): string {
  return `The transaction is queued behind a nonce gap: the wallet submitted nonce ${txNonce}, but the local chain is still waiting for nonce ${pendingNonce}. Clear the wallet's local activity/nonce state for this fixture chain, or submit/cancel the missing nonce first.`
}
