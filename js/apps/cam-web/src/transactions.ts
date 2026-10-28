import type {
  simulateCamContractCall,
} from "@cam/evm-viem"
import type {
  CamViewerPreparedContractCall,
} from "@cam/viewer"
import { viewerErrorMessage } from "@cam/viewer"
import { evmChainMetadata } from "@cam/evm-viem"
import { requireHttpURL } from "@cam/protocol"
import type {
  Address,
} from "viem"

import type {
  StartupOptions,
} from "./startup.ts"

export type SubmittedTransactionReference = {
  readonly chainId: string
  readonly hash: `0x${string}`
}

export async function transactionExplorer(transaction: SubmittedTransactionReference): Promise<{ readonly name: string; readonly url: string } | undefined> {
  const explorer = (await evmChainMetadata(transaction.chainId))?.blockExplorers?.default
  if (explorer === undefined) return undefined
  const url = new URL(requireHttpURL(explorer.url, "Block explorer URL").href)
  url.pathname = `${url.pathname.replace(/\/$/, "")}/tx/${transaction.hash}`
  return { name: explorer.name, url: url.href }
}

export type SubmittedTransaction = {
  readonly blockNumber: bigint | null
  readonly from: `0x${string}`
  readonly nonce: number
}

export type TransactionReader<TReceipt> = {
  readonly getTransaction: (args: { readonly hash: `0x${string}` }) => Promise<SubmittedTransaction | null | undefined>
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

export type PreparedCallSimulationClient = Parameters<typeof simulateCamContractCall>[0]["publicClient"]
export type TransactionStage = "checking" | "wallet" | "confirming" | "refreshing"

export type PreparedCallSubmitterPorts<TWalletClient, TChain> = {
  readonly ensureAccount: (address: Address) => Promise<void>
  readonly simulate: (args: {
    readonly publicClient: PreparedCallSimulationClient
    readonly account: Address
    readonly call: CamViewerPreparedContractCall
  }) => Promise<unknown>
  readonly ensureChain: (startup: StartupOptions) => Promise<void>
  readonly createWalletClient: (address: Address, startup: StartupOptions, shouldContinue: () => boolean) => TWalletClient
  readonly chain: (startup: StartupOptions) => TChain
  readonly send: (args: {
    readonly walletClient: TWalletClient
    readonly chain: TChain
    readonly call: CamViewerPreparedContractCall
  }) => Promise<`0x${string}`>
}

export class SubmissionOutcomeUnknownError extends Error {
  constructor(cause: unknown) {
    super("The wallet request failed without a transaction hash. The transaction may have been sent. Check wallet activity before preparing or sending another transaction.", { cause })
    this.name = "SubmissionOutcomeUnknownError"
  }
}

export async function submitPreparedContractCall<TWalletClient, TChain>({
  ports,
  publicClient,
  walletAddress,
  startup,
  call,
  shouldContinue,
  onStage,
}: {
  readonly ports: PreparedCallSubmitterPorts<TWalletClient, TChain>
  readonly publicClient: PreparedCallSimulationClient
  readonly walletAddress: Address
  readonly startup: StartupOptions
  readonly call: CamViewerPreparedContractCall
  readonly shouldContinue: () => boolean
  readonly onStage?: (stage: "checking" | "wallet") => void
}): Promise<`0x${string}` | undefined> {
  // Wallet state can change while the wallet opens chain-switch or signing UI.
  // Keep each external effect explicit so tests can prove the safety order.
  onStage?.("checking")
  await ports.ensureAccount(walletAddress)
  if (!shouldContinue()) return undefined

  await ports.simulate({
    publicClient,
    account: walletAddress,
    call,
  })
  if (!shouldContinue()) return undefined

  onStage?.("wallet")
  await ports.ensureChain(startup)
  if (!shouldContinue()) return undefined

  await ports.ensureAccount(walletAddress)
  if (!shouldContinue()) return undefined

  const walletClient = ports.createWalletClient(walletAddress, startup, shouldContinue)
  const chain = ports.chain(startup)
  try {
    return await ports.send({ walletClient, chain, call })
  } catch (cause) {
    throw classifySubmissionFailure(cause)
  }
}

function classifySubmissionFailure(error: unknown): unknown {
  const seen = new Set<object>()
  let current = error
  try {
    while (typeof current === "object" && current !== null && !seen.has(current) && seen.size < 32) {
      seen.add(current)
      const failure = current as { readonly code?: unknown; readonly cause?: unknown; readonly data?: unknown }
      if (failure.code === 4001) return error
      if (failure.code === -32099 && typeof failure.data === "object" && failure.data !== null
        && (failure.data as { readonly submission?: unknown }).submission === "not-submitted") return error
      current = failure.cause
    }
  } catch {
    // Unreadable provider fields cannot prove rejection. Preserve the original
    // failure as the cause of an uncertain submission, not the accessor error.
  }
  return new SubmissionOutcomeUnknownError(error)
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
    let advice: string
    try {
      advice = receiptTimeoutAdvice(await submittedTransactionDiagnosis({
        client,
        txHash,
        rpcEndpoint,
        includePendingAdvice: true,
      }))
    } catch (diagnosisCause) {
      advice = `The viewer also could not inspect the submitted transaction on ${rpcEndpoint}: ${viewerErrorMessage(diagnosisCause)}.`
    }
    throw new Error(
      [
        `Transaction was sent, but receipt checking on ${rpcEndpoint} failed.`,
        advice,
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
    const tx = await client.getTransaction({ hash: txHash })
    if (tx === null || tx === undefined) {
      throw new Error("transaction not found")
    }
    return tx
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
