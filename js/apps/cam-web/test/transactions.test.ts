import assert from "node:assert/strict"
import test from "node:test"

import type {
  CamViewerPreparedContractCall,
} from "@cam/viewer"
import type {
  Address,
} from "viem"

import type {
  StartupOptions,
} from "../src/startup.ts"
import {
  submittedTransactionDiagnosis,
  submitPreparedContractCall,
  waitForSubmittedTransactionReceipt,
} from "../src/transactions.ts"
import type {
  PreparedCallSimulationClient,
  PreparedCallSubmitterPorts,
  SubmittedTransaction,
  TransactionReader,
} from "../src/transactions.ts"

const txHash = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
const from = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
const walletAddress = "0x0000000000000000000000000000000000000001" as Address
const sentHash = "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"

type TestReceipt = {
  readonly status: "success" | "reverted"
}

type TestPorts = PreparedCallSubmitterPorts<string, string>

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

test("prepared call submission proves wallet revalidation after chain switching", async () => {
  const events: string[] = []
  let continueCalls = 0

  const result = await submitPreparedContractCall({
    ports: recordingPorts(events),
    publicClient: testPublicClient(),
    walletAddress,
    startup: testStartup(),
    call: testCall(),
    shouldContinue() {
      continueCalls += 1
      events.push(`continue:${continueCalls.toString()}`)
      return true
    },
  })

  assert.equal(result, sentHash)
  assert.deepEqual(events, [
    "ensureAccount",
    "simulate",
    "continue:1",
    "ensureChain",
    "continue:2",
    "ensureAccount",
    "createWalletClient",
    "chain",
    "send",
  ])
})

test("prepared call submission aborts before chain switching when interaction becomes stale", async () => {
  const events: string[] = []

  const result = await submitPreparedContractCall({
    ports: recordingPorts(events),
    publicClient: testPublicClient(),
    walletAddress,
    startup: testStartup(),
    call: testCall(),
    shouldContinue() {
      events.push("continue")
      return false
    },
  })

  assert.equal(result, undefined)
  assert.deepEqual(events, [
    "ensureAccount",
    "simulate",
    "continue",
  ])
})

test("prepared call submission aborts before signing when chain switching makes the interaction stale", async () => {
  const events: string[] = []
  let continueCalls = 0

  const result = await submitPreparedContractCall({
    ports: recordingPorts(events),
    publicClient: testPublicClient(),
    walletAddress,
    startup: testStartup(),
    call: testCall(),
    shouldContinue() {
      continueCalls += 1
      events.push(`continue:${continueCalls.toString()}`)
      return continueCalls === 1
    },
  })

  assert.equal(result, undefined)
  assert.deepEqual(events, [
    "ensureAccount",
    "simulate",
    "continue:1",
    "ensureChain",
    "continue:2",
  ])
})

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

function recordingPorts(events: string[]): TestPorts {
  return {
    async ensureAccount() {
      events.push("ensureAccount")
    },
    async simulate() {
      events.push("simulate")
    },
    async ensureChain() {
      events.push("ensureChain")
    },
    createWalletClient() {
      events.push("createWalletClient")
      return "wallet-client"
    },
    chain() {
      events.push("chain")
      return "chain"
    },
    async send() {
      events.push("send")
      return sentHash
    },
  }
}

function testPublicClient(): PreparedCallSimulationClient {
  return {} as PreparedCallSimulationClient
}

function testStartup(): StartupOptions {
  return {
    chainId: "eip155:31337",
    host: "0x0000000000000000000000000000000000000002",
    account: walletAddress,
    rpcUrl: "http://127.0.0.1:8545",
    resourceOrigin: "http://127.0.0.1:5173",
    allowUnsignedCamHash: false,
  }
}

function testCall(): CamViewerPreparedContractCall {
  return {
    route: "submit",
    address: "0x0000000000000000000000000000000000000003",
    abi: [],
    function: "submit",
    args: {},
    then: {
      namespace: "routes",
      function: "done",
      args: {},
    },
  }
}

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
