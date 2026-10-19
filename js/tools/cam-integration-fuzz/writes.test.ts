import assert from "node:assert/strict"
import test from "node:test"
import { createCamViewerSession } from "../../packages/cam-viewer/dist/index.js"
import { CamEvmError } from "../../packages/cam-evm-viem/dist/index.js"
import { handlePreparedWrite } from "./writes.ts"
import type { CamViewerPreparedContractCall } from "../../packages/cam-viewer/dist/index.js"

const address = "0x0000000000000000000000000000000000000001"
const hash = `0x${"a".repeat(64)}` as `0x${string}`
const largePayableValue = "900719925474099312345"
const chain = { id: 31337, name: "fixture", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: ["http://unused.invalid"] } } }
const call: CamViewerPreparedContractCall = { address, abi: [{ type: "function", name: "act", stateMutability: "nonpayable", inputs: [], outputs: [] }], function: "act", args: {}, route: "act", then: { namespace: "routes", function: "entry", args: {} } }
const payableCall = (value: string): CamViewerPreparedContractCall => ({
  ...call,
  abi: [{ type: "function", name: "act", stateMutability: "payable", inputs: [], outputs: [] }],
  value,
})
function unusedSession() {
  return createCamViewerSession({ host: { address, chainId: "eip155:31337" }, inputs: {}, publicClient: { getChainId: async () => 31337, readContract: async () => { throw new Error("Unexpected contract read") } }, loadResource: async () => { throw new Error("Unexpected resource load") } })
}

test("a rejected fixture simulation reports its revert, retains the cause and never submits", async t => {
  const events: Record<string, unknown>[] = []
  t.mock.method(console, "log", (line: string) => events.push(JSON.parse(line)))
  const cause = Object.assign(new Error("execution reverted"), { data: { errorName: "Unauthorized", args: [address] } })
  let simulationHasValue = true
  let sends = 0
  await assert.rejects(() => handlePreparedWrite({
    publicClient: { simulateContract: async request => { simulationHasValue = Object.hasOwn(request, "value"); throw cause } }, account: address, run: 1, step: 2, session: unusedSession(), call,
    receiptClient: { waitForTransactionReceipt: async () => { throw new Error("Unexpected receipt read") } },
    writeContext: { kind: "local-fixture", chain, walletClient: { writeContract: async () => { sends += 1; return hash } } },
  }), error => {
    assert(error instanceof Error)
    assert(error.cause instanceof CamEvmError)
    assert.equal(error.cause.cause, cause)
    return true
  })
  assert.equal(sends, 0)
  assert.equal(events.length, 1)
  assert.equal(events[0]?.status, "rejected")
  assert.equal(simulationHasValue, false)
  assert.equal(Object.hasOwn(events[0]?.call as object, "value"), false)
  assert.match(String(events[0]?.error), /Unauthorized/)
})

test("accepted payable simulations preserve exact values in events and send bigint values to the adapter", async t => {
  for (const value of ["0", largePayableValue]) {
    await t.test(`value ${value}`, async t => {
      const events: Record<string, unknown>[] = []
      t.mock.method(console, "log", (line: string) => events.push(JSON.parse(line)))
      let simulationValue: unknown
      await handlePreparedWrite({
        publicClient: { simulateContract: async request => { simulationValue = request.value } },
        account: address,
        run: 1,
        step: 2,
        session: unusedSession(),
        call: payableCall(value),
        receiptClient: { waitForTransactionReceipt: async () => { throw new Error("Unexpected receipt read") } },
        writeContext: { kind: "simulate" },
      })

      assert.equal(simulationValue, BigInt(value))
      assert.equal(events[0]?.status, "accepted")
      assert.deepEqual(events[0]?.call, { route: "act", address, function: "act", args: {}, value })
    })
  }
})

test("rejected payable simulations retain the exact declared value", async t => {
  const events: Record<string, unknown>[] = []
  t.mock.method(console, "log", (line: string) => events.push(JSON.parse(line)))
  let simulationValue: unknown
  await handlePreparedWrite({
    publicClient: { simulateContract: async request => { simulationValue = request.value; throw new Error("insufficient funds") } },
    account: address,
    run: 1,
    step: 2,
    session: unusedSession(),
    call: payableCall(largePayableValue),
    receiptClient: { waitForTransactionReceipt: async () => { throw new Error("Unexpected receipt read") } },
    writeContext: { kind: "simulate" },
  })

  assert.equal(simulationValue, BigInt(largePayableValue))
  assert.equal(events[0]?.status, "rejected")
  assert.deepEqual(events[0]?.call, { route: "act", address, function: "act", args: {}, value: largePayableValue })
})

test("a submitted write receipt failure retains the hash and cause without inventing a timeout", async t => {
  const events: Record<string, unknown>[] = []
  t.mock.method(console, "log", (line: string) => events.push(JSON.parse(line)))
  const cause = new Error("RPC authentication rejected")
  let sends = 0
  let simulationValue: unknown
  let submittedValue: unknown
  await assert.rejects(() => handlePreparedWrite({
    publicClient: { simulateContract: async request => { simulationValue = request.value } }, account: address, run: 1, step: 2, session: unusedSession(), call: payableCall(largePayableValue),
    receiptClient: { waitForTransactionReceipt: async () => { throw cause } },
    writeContext: { kind: "local-fixture", chain, walletClient: { writeContract: async request => { sends += 1; submittedValue = request.value; return hash } } },
  }), error => {
    assert(error instanceof Error)
    assert.equal(error.cause, cause)
    assert(error.message.includes(hash) && error.message.includes("act"))
    assert.doesNotMatch(error.message, /within 20s|timeout/i)
    return true
  })
  assert.equal(sends, 1)
  assert.equal(simulationValue, BigInt(largePayableValue))
  assert.equal(submittedValue, BigInt(largePayableValue))
  const submitted = events.find(event => event.event === "write_transaction" && event.status === "submitted" && event.hash === hash)
  assert(submitted)
  assert.deepEqual(submitted.call, { route: "act", address, function: "act", args: {}, value: largePayableValue })
  assert(!events.some(event => event.status === "success"))
})
