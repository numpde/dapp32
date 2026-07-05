import assert from "node:assert/strict"
import test from "node:test"

import {
  submittedTransactionDiagnosis,
  waitForSubmittedTransactionReceipt,
} from "../src/transactions.ts"
import type {
  SubmittedTransaction,
  TransactionReader,
} from "../src/transactions.ts"

const txHash = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
const from = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"

type TestReceipt = {
  readonly status: "success" | "reverted"
}

function reader(options: {
  readonly tx?: SubmittedTransaction
  readonly pendingNonce?: number
  readonly receipt?: TestReceipt
  readonly receiptError?: Error
  readonly txError?: Error
} = {}): TransactionReader<TestReceipt> {
  let tx = options.tx
  if (tx === undefined) {
    tx = {
      blockNumber: null,
      from,
      nonce: 5,
    }
  }
  let pendingNonce = options.pendingNonce
  if (pendingNonce === undefined) {
    pendingNonce = 3
  }
  let receipt = options.receipt
  if (receipt === undefined) {
    receipt = { status: "success" }
  }

  return {
    async getTransaction() {
      if (options.txError !== undefined) throw options.txError
      return tx
    },
    async getTransactionCount() {
      return pendingNonce
    },
    async waitForTransactionReceipt() {
      if (options.receiptError !== undefined) throw options.receiptError
      return receipt
    },
  }
}

test("submitted transaction diagnosis reports nonce gaps", async () => {
  const diagnosis = await submittedTransactionDiagnosis({
    client: reader(),
    txHash,
    rpcEndpoint: "localhost:8545",
    includePendingAdvice: false,
  })

  assert.equal(
    diagnosis,
    "The transaction is queued behind a nonce gap: the wallet submitted nonce 5, but the local chain is still waiting for nonce 3. Clear the wallet's local activity/nonce state for this fixture chain, or submit/cancel the missing nonce first.",
  )
})

test("submitted transaction diagnosis distinguishes mined and pending transactions", async () => {
  assert.equal(
    await submittedTransactionDiagnosis({
      client: reader({
        tx: {
          blockNumber: 12n,
          from,
          nonce: 5,
        },
      }),
      txHash,
      rpcEndpoint: "localhost:8545",
      includePendingAdvice: true,
    }),
    undefined,
  )

  assert.equal(
    await submittedTransactionDiagnosis({
      client: reader({ pendingNonce: 5 }),
      txHash,
      rpcEndpoint: "localhost:8545",
      includePendingAdvice: true,
    }),
    "The transaction is known by the local RPC but is still pending at nonce 5. Check whether local mining is paused or the wallet left the transaction in the mempool.",
  )
})

test("receipt timeout includes submitted transaction diagnosis", async () => {
  await assert.rejects(
    () => waitForSubmittedTransactionReceipt({
      client: reader({ receiptError: new Error("timeout") }),
      txHash,
      rpcEndpoint: "localhost:8545",
      pollingIntervalMs: 500,
      timeoutMs: 20_000,
    }),
    /Transaction was sent, but the viewer did not see a receipt on localhost:8545 within 20s\. The transaction is queued behind a nonce gap/,
  )
})

test("submitted transaction read failures include the RPC endpoint", async () => {
  await assert.rejects(
    () => submittedTransactionDiagnosis({
      client: reader({ txError: new Error("not found") }),
      txHash,
      rpcEndpoint: "localhost:8545",
      includePendingAdvice: true,
    }),
    /could not read that transaction from localhost:8545/,
  )
})
