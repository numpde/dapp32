import assert from "node:assert/strict"
import test from "node:test"

import type {
  CamViewerPreparedContractCall,
} from "@cam/viewer"
import type {
  Address,
} from "viem"
import { HttpRequestError, UserRejectedRequestError } from "viem"
import { viewerErrorMessage } from "@cam/viewer"
import { createInjectedWalletBinding } from "../src/wallet-binding.ts"

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
  readonly tx?: SubmittedTransaction | null
  readonly txMissing?: boolean
  readonly pendingNonce?: number
  readonly receipt?: TestReceipt
  readonly receiptError?: unknown
  readonly txError?: unknown
  readonly countError?: unknown
} = {}): TransactionReader<TestReceipt> {
  let tx: SubmittedTransaction | null | undefined
  if (options.txMissing === true) {
    tx = undefined
  } else if ("tx" in options) {
    tx = options.tx
  } else {
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
      if (options.countError !== undefined) throw options.countError
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
    "continue:1",
    "simulate",
    "continue:2",
    "ensureChain",
    "continue:3",
    "ensureAccount",
    "continue:4",
    "createWalletClient",
    "chain",
    "send",
  ])
})

test("prepared call submission aborts before simulation when account check makes the interaction stale", async () => {
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
    "continue",
  ])
})

test("prepared call submission aborts before chain switching when simulation makes the interaction stale", async () => {
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
    "continue:1",
    "simulate",
    "continue:2",
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
      return continueCalls < 3
    },
  })

  assert.equal(result, undefined)
  assert.deepEqual(events, [
    "ensureAccount",
    "continue:1",
    "simulate",
    "continue:2",
    "ensureChain",
    "continue:3",
  ])
})

test("prepared call submission aborts before sending when final account check makes the interaction stale", async () => {
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
      return continueCalls < 4
    },
  })

  assert.equal(result, undefined)
  assert.deepEqual(events, [
    "ensureAccount",
    "continue:1",
    "simulate",
    "continue:2",
    "ensureChain",
    "continue:3",
    "ensureAccount",
    "continue:4",
  ])
})

test("a send failure reports possible submission and preserves the original cause", async () => {
  for (const cause of [new Error("response lost"), { code: -32603, message: "transport failed" }, "connection closed"]) {
    const ports = recordingPorts([])
    await assert.rejects(
      () => submitPreparedContractCall({
        ports: { ...ports, async send() { throw cause } },
        publicClient: testPublicClient(),
        walletAddress,
        startup: testStartup(),
        call: testCall(),
        shouldContinue: () => true,
      }),
      (error) => error instanceof Error
        && /may have been sent/i.test(error.message)
        && error.cause === cause,
    )
  }
})

test("proven wallet rejection remains distinct from uncertain submission through wrapped causes", async () => {
  const rejection = new UserRejectedRequestError(new Error("User rejected the request"))
  const wrappedRejection = new Error("CAM write failed", { cause: new Error("Wallet request failed", { cause: rejection }) })
  const providerRejection = new Error("CAM write failed", { cause: { code: 4001, message: "User rejected the request" } })
  for (const cause of [rejection, wrappedRejection, providerRejection]) {
    await assert.rejects(
      () => submitPreparedContractCall({
        ports: { ...recordingPorts([]), async send() { throw cause } },
        publicClient: testPublicClient(),
        walletAddress,
        startup: testStartup(),
        call: testCall(),
        shouldContinue: () => true,
      }),
      (error) => error === cause,
    )
  }
})

test("provider evidence that broadcasting never started stays distinct from an unknown submission", async () => {
  for (const submission of ["not-submitted", "unknown"]) {
    const providerFailure = { code: -32099, message: "Local fixture submission failed", data: { submission } }
    const cause = new Error("Wallet contract call failed", { cause: providerFailure })
    await assert.rejects(submitPreparedContractCall({
      ports: { ...recordingPorts([]), async send() { throw cause } },
      publicClient: testPublicClient(), walletAddress, startup: testStartup(), call: testCall(), shouldContinue: () => true,
    }), error => {
      if (submission === "not-submitted") assert.equal(error, cause)
      else assert(error instanceof Error && /may have been sent/i.test(error.message) && error.cause === cause)
      return true
    })
  }
})

test("unrecognized provider metadata cannot prove that broadcasting never started", async () => {
  const unreadable = { code: -32099, get data(): never { throw new Error("unreadable submission metadata") } }
  for (const providerFailure of [
    unreadable,
    { code: -32603, data: { submission: "not-submitted" } },
    { code: -32099, data: { submission: "rejected" } },
  ]) {
    await assert.rejects(submitPreparedContractCall({
      ports: { ...recordingPorts([]), async send() { throw providerFailure } },
      publicClient: testPublicClient(), walletAddress, startup: testStartup(), call: testCall(), shouldContinue: () => true,
    }), error => error instanceof Error && error.cause === providerFailure && /may have been sent/i.test(error.message))
  }
})

test("unreadable or cyclic provider failures remain uncertain without losing the original cause", async () => {
  const cyclic: { cause?: unknown } = {}
  cyclic.cause = cyclic
  const hostileCode = { get code(): never { throw new Error("code getter failed") } }
  const hostileCause = { get cause(): never { throw new Error("cause getter failed") } }
  for (const cause of [cyclic, hostileCode, hostileCause]) {
    await assert.rejects(
      () => submitPreparedContractCall({
        ports: { ...recordingPorts([]), async send() { throw cause } },
        publicClient: testPublicClient(),
        walletAddress,
        startup: testStartup(),
        call: testCall(),
        shouldContinue: () => true,
      }),
      (error) => error instanceof Error
        && /may have been sent/i.test(error.message)
        && error.cause === cause,
    )
  }
})

test("failures before wallet submission retain their original outcome and do not send", async () => {
  for (const stage of ["ensureAccount", "simulate", "ensureChain", "createWalletClient", "chain"] as const) {
    const cause = new Error(`${stage} failed`)
    const events: string[] = []
    const ports = recordingPorts(events)
    const failingPorts = { ...ports, [stage]: () => { throw cause } }
    await assert.rejects(
      () => submitPreparedContractCall({
        ports: failingPorts,
        publicClient: testPublicClient(),
        walletAddress,
        startup: testStartup(),
        call: testCall(),
        shouldContinue: () => true,
      }),
      (error) => error === cause,
    )
    assert.equal(events.includes("send"), false)
  }
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

    inputs: {},
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

test("receipt inspection failures retain their cause without claiming a timeout or a failed send", async () => {
  const cause = new Error("RPC authentication rejected")
  await assert.rejects(() => waitForSubmittedTransactionReceipt({ client: reader({ receiptError: cause }), txHash, rpcEndpoint: "localhost:8545", pollingIntervalMs: 500, timeoutMs: 20_000 }), error => {
    assert(error instanceof Error)
    assert.equal(error.cause, cause)
    assert.match(error.message, /Transaction was sent/)
    assert.match(error.message, /receipt.*failed/i)
    assert.doesNotMatch(error.message, /within 20s|timed? ?out/i)
    return true
  })
})

test("receipt checking failure includes submitted transaction diagnosis", async () => {
  await assert.rejects(
    () => waitForSubmittedTransactionReceipt({
      client: reader({ receiptError: new Error("timeout") }),
      txHash,
      rpcEndpoint: "localhost:8545",
      pollingIntervalMs: 500,
      timeoutMs: 20_000,
    }),
    /Transaction was sent, but receipt checking on localhost:8545 failed\. The transaction is queued behind a nonce gap/,
  )
})

test("receipt checking failure preserves context when follow-up diagnosis fails", async () => {
  await assert.rejects(
    () => waitForSubmittedTransactionReceipt({
      client: reader({
        receiptError: new Error("timeout"),
        txError: new Error("not found"),
      }),
      txHash,
      rpcEndpoint: "localhost:8545",
      pollingIntervalMs: 500,
      timeoutMs: 20_000,
    }),
    /Transaction was sent, but receipt checking on localhost:8545 failed\. The viewer also could not inspect the submitted transaction/,
  )
})

test("receipt diagnosis preserves SDK evidence without flattening signed request bodies", async () => {
  const sdkFailure = new HttpRequestError({
    url: "https://rpc.example.test/?api_key=private-rpc-key",
    body: { method: "eth_sendRawTransaction", params: ["private-signed-transaction"] },
    details: "upstream disconnected",
  })
  await assert.rejects(waitForSubmittedTransactionReceipt({
    client: reader({ receiptError: new Error("receipt timeout"), txError: sdkFailure }),
    txHash, rpcEndpoint: "https://rpc.example.test", pollingIntervalMs: 500, timeoutMs: 20_000,
  }), error => {
    const diagnostic = viewerErrorMessage(error)
    assert.match(diagnostic, /upstream disconnected/)
    assert.match(diagnostic, /receipt timeout/)
    assert.doesNotMatch(diagnostic, /private-rpc-key|private-signed-transaction|Request body/)
    return true
  })
})

test("receipt checking failure bounds follow-up diagnosis errors", async () => {
  const long = "x".repeat(1_000)
  await assert.rejects(
    () => waitForSubmittedTransactionReceipt({
      client: reader({
        receiptError: new Error("timeout"),
        countError: new Error(long),
      }),
      txHash,
      rpcEndpoint: "localhost:8545",
      pollingIntervalMs: 500,
      timeoutMs: 20_000,
    }),
    (error) => error instanceof Error
      && error.message.includes(`The viewer also could not inspect the submitted transaction on localhost:8545: ${"x".repeat(500)}...`)
      && !error.message.includes("x".repeat(501)),
  )
})

test("receipt checking failure survives hostile follow-up diagnosis errors", async () => {
  const hostile = {
    toString() {
      throw new Error("hostile toString")
    },
  }

  await assert.rejects(
    () => waitForSubmittedTransactionReceipt({
      client: reader({
        receiptError: new Error("timeout"),
        countError: hostile,
      }),
      txHash,
      rpcEndpoint: "localhost:8545",
      pollingIntervalMs: 500,
      timeoutMs: 20_000,
    }),
    /The viewer also could not inspect the submitted transaction on localhost:8545: unprintable error\./,
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

test("submitted transaction read treats missing RPC results as read failures", async () => {
  await assert.rejects(
    () => submittedTransactionDiagnosis({
      client: reader({ tx: null }),
      txHash,
      rpcEndpoint: "localhost:8545",
      includePendingAdvice: true,
    }),
    /could not read that transaction from localhost:8545/,
  )

  await assert.rejects(
    () => submittedTransactionDiagnosis({
      client: reader({ txMissing: true }),
      txHash,
      rpcEndpoint: "localhost:8545",
      includePendingAdvice: true,
    }),
    /could not read that transaction from localhost:8545/,
  )
})

for (const event of ["accountsChanged", "chainChanged", "disconnect"]) {
  test(`${event} during simulation invalidates the unsent prepared call`, async () => {
    const f = await boundWalletForSubmission()
    const events: string[] = []
    let release!: () => void
    let entered!: () => void
    const held = new Promise<void>(resolve => { release = resolve })
    const simulating = new Promise<void>(resolve => { entered = resolve })
    const pending = submitPreparedContractCall({
      ports: { ...recordingPorts(events), simulate: async () => { events.push("simulate"); entered(); await held } },
      publicClient: testPublicClient(), walletAddress, startup: testStartup(), call: testCall(),
      shouldContinue: f.ownsInteraction,
    })
    await simulating
    f.emit(event)
    release()
    assert.equal(await pending, undefined)
    assert.deepEqual(events, ["ensureAccount", "simulate"])
    f.binding.dispose()
  })

  test(`${event} after wallet submission preserves the transaction hash and receipt tracking`, async () => {
    const f = await boundWalletForSubmission()
    const events: string[] = []
    const hash = await submitPreparedContractCall({
      ports: recordingPorts(events), publicClient: testPublicClient(), walletAddress,
      startup: testStartup(), call: testCall(), shouldContinue: f.ownsInteraction,
    })
    assert.equal(hash, sentHash)
    let release!: () => void
    const held = new Promise<void>(resolve => { release = resolve })
    const receipt = waitForSubmittedTransactionReceipt({
      client: { ...reader(), waitForTransactionReceipt: async ({ hash: requested }) => {
        assert.equal(requested, sentHash)
        await held
        return { status: "success" as const }
      } },
      txHash: hash!, rpcEndpoint: "localhost:8545", pollingIntervalMs: 500, timeoutMs: 20_000,
    })
    f.emit(event)
    assert.equal(f.ownsInteraction(), false)
    release()
    assert.deepEqual(await receipt, { status: "success" })
    assert.equal(events.filter(value => value === "send").length, 1)
    f.binding.dispose()
  })
}

async function boundWalletForSubmission() {
  const listeners = new Map<string, (value: unknown) => void>()
  Object.defineProperty(globalThis, "window", { configurable: true, value: { ethereum: {
    request: async () => { throw new Error("unsolicited provider request") },
    on: (event: string, listener: (value: unknown) => void) => listeners.set(event, listener),
    removeListener: (event: string) => listeners.delete(event),
  } } })
  let currentInteraction = true
  const binding = createInjectedWalletBinding({
    chainId: "eip155:31337", connect: async () => walletAddress,
    isViewBusy: () => false, setAccount: async address => address,
    commitAccount: () => {}, invalidate: () => { currentInteraction = false },
    onState: () => {}, onError: error => { throw error },
  })
  await binding.connect()
  currentInteraction = true
  return {
    binding,
    ownsInteraction: () => currentInteraction,
    emit: (event: string) => listeners.get(event)?.(event === "accountsChanged" ? [] : event === "chainChanged" ? "0x1" : { code: 4900 }),
  }
}

// These host laws also apply to Bike handover and workshop calls. Keep them
// generic here: the host must not infer ownership changes from a send result.
test("an explicit retry after wallet rejection revalidates and simulates before its only new send", async () => {
  const events: string[] = []
  const rejection = new UserRejectedRequestError(new Error("User rejected the request"))
  let attempts = 0
  const call = testCall()
  const ports: TestPorts = {
    ...recordingPorts(events),
    async send({ call: submitted }) {
      assert.equal(submitted, call)
      events.push("send")
      attempts += 1
      if (attempts === 1) throw rejection
      return sentHash
    },
  }
  const submit = () => submitPreparedContractCall({
    ports, publicClient: testPublicClient(), walletAddress,
    startup: testStartup(), call, shouldContinue: () => true,
  })
  await assert.rejects(submit, error => error === rejection)
  assert.equal(attempts, 1, "rejection must not cause automatic resubmission")
  const firstAttempt = [...events]
  events.length = 0
  assert.equal(await submit(), sentHash)
  assert.deepEqual(events, firstAttempt, "an explicit retry must repeat all pre-send checks")
  assert.equal(attempts, 2)
})

test("receipt inspection can be retried for the original hash without repeating wallet submission", async () => {
  const events: string[] = []
  const hash = await submitPreparedContractCall({
    ports: recordingPorts(events), publicClient: testPublicClient(), walletAddress,
    startup: testStartup(), call: testCall(), shouldContinue: () => true,
  })
  assert.equal(hash, sentHash)
  const inspected: `0x${string}`[] = []
  const outage = new Error("receipt RPC temporarily unavailable")
  const confirmed = { status: "success" as const, blockNumber: 12n }
  const client = {
    ...reader({ pendingNonce: 5 }),
    async waitForTransactionReceipt({ hash: requested }: { readonly hash: `0x${string}` }) {
      inspected.push(requested)
      if (inspected.length === 1) throw outage
      return confirmed
    },
  }
  const inspect = () => waitForSubmittedTransactionReceipt({
    client, txHash: hash!, rpcEndpoint: "localhost:8545",
    pollingIntervalMs: 500, timeoutMs: 20_000,
  })
  await assert.rejects(inspect, error => {
    assert(error instanceof Error)
    assert.equal(error.cause, outage)
    assert.match(error.message, /Transaction was sent/)
    assert.match(error.message, /still pending/)
    assert.doesNotMatch(error.message, /confirmed|reverted/)
    return true
  })
  assert.deepEqual(inspected, [sentHash], "receipt failure must not trigger an implicit retry")
  assert.equal(await inspect(), confirmed)
  assert.deepEqual(inspected, [sentHash, sentHash])
  assert.equal(events.filter(event => event === "send").length, 1)
})

test("a mined reverted receipt remains reverted rather than becoming a successful confirmation", async () => {
  const receipt = { status: "reverted" as const, blockNumber: 12n }
  assert.equal(await waitForSubmittedTransactionReceipt({
    client: { ...reader(), waitForTransactionReceipt: async () => receipt },
    txHash, rpcEndpoint: "localhost:8545", pollingIntervalMs: 500, timeoutMs: 20_000,
  }), receipt)
})
