import assert from "node:assert/strict"
import test from "node:test"
import { createCamViewerSession } from "../../packages/cam-viewer/dist/index.js"
import { CamEvmError } from "../../packages/cam-evm-viem/dist/index.js"
import { handlePreparedWrite } from "./writes.ts"
import type { CamViewerPreparedContractCall } from "../../packages/cam-viewer/dist/index.js"

const address = "0x0000000000000000000000000000000000000001"
const hash = `0x${"a".repeat(64)}` as `0x${string}`
const chain = { id: 31337, name: "fixture", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: ["http://unused.invalid"] } } }
const call: CamViewerPreparedContractCall = { address, abi: [{ type: "function", name: "act", stateMutability: "nonpayable", inputs: [], outputs: [] }], function: "act", args: {}, route: "act", then: { namespace: "routes", function: "entry", args: {} } }
function unusedSession() {
  return createCamViewerSession({ host: { address, chainId: "eip155:31337" }, inputs: {}, publicClient: { getChainId: async () => 31337, readContract: async () => { throw new Error("Unexpected contract read") } }, loadResource: async () => { throw new Error("Unexpected resource load") } })
}

test("a rejected fixture simulation reports its revert, retains the cause and never submits", async t => {
  const events: Record<string, unknown>[] = []
  t.mock.method(console, "log", (line: string) => events.push(JSON.parse(line)))
  const cause = Object.assign(new Error("execution reverted"), { data: { errorName: "Unauthorized", args: [address] } })
  let sends = 0
  await assert.rejects(() => handlePreparedWrite({
    publicClient: { simulateContract: async () => { throw cause } }, account: address, run: 1, step: 2, session: unusedSession(), call,
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
  assert.match(String(events[0]?.error), /Unauthorized/)
})

test("a submitted write receipt failure retains the hash and cause without inventing a timeout", async t => {
  const events: Record<string, unknown>[] = []
  t.mock.method(console, "log", (line: string) => events.push(JSON.parse(line)))
  const cause = new Error("RPC authentication rejected")
  let sends = 0
  await assert.rejects(() => handlePreparedWrite({
    publicClient: { simulateContract: async () => undefined }, account: address, run: 1, step: 2, session: unusedSession(), call,
    receiptClient: { waitForTransactionReceipt: async () => { throw cause } },
    writeContext: { kind: "local-fixture", chain, walletClient: { writeContract: async () => { sends += 1; return hash } } },
  }), error => {
    assert(error instanceof Error)
    assert.equal(error.cause, cause)
    assert(error.message.includes(hash) && error.message.includes("act"))
    assert.doesNotMatch(error.message, /within 20s|timeout/i)
    return true
  })
  assert.equal(sends, 1)
  assert(events.some(event => event.event === "write_transaction" && event.status === "submitted" && event.hash === hash))
  assert(!events.some(event => event.status === "success"))
})
