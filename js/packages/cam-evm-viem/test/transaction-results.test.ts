import assert from "node:assert/strict"
import { test } from "node:test"
import { encodeAbiParameters, toEventSelector, parseAbi } from "viem"
import type { Abi } from "viem"
import type { CamMinedTransaction, CamMinedReceipt } from "../src/index.ts"
import { encodeCamContractCall, interpretCamReceipt, receiptEventAbi, reviewCamContractCall } from "../src/index.ts"

const address = "0x1111111111111111111111111111111111111111"
const account = "0x2222222222222222222222222222222222222222"
const payee = "0x3333333333333333333333333333333333333333"
const hash = `0x${"ab".repeat(32)}` as const
const blockHash = `0x${"cd".repeat(32)}` as const
const abi = parseAbi([
  "function collect(uint256 cap) returns (uint256)",
  "function position() view returns (address payee)",
  "event Paid(address indexed payee, uint256 amount)",
])
const call = { address, abi, function: "collect", args: { cap: "30" } } as const
const transaction = { hash, blockHash, blockNumber: 7n, from: account, to: address, input: encodeCamContractCall(call), value: 0n } as CamMinedTransaction
const paymentLog: CamMinedReceipt["logs"][number] = {
  address, data: encodeAbiParameters([{ type: "uint256" }], [20n]),
  topics: [toEventSelector("Paid(address,uint256)"), encodeAbiParameters([{ type: "address" }], [payee])],
}
function receipt(logs: CamMinedReceipt["logs"]): CamMinedReceipt {
  return { status: "success", transactionHash: hash, blockHash, blockNumber: 7n, from: account, to: address, logs }
}

test("collection outcomes use mined payment and recipient; foreign logs cannot supply them", () => {
  const interpret = (logs: CamMinedReceipt["logs"]) => interpretCamReceipt({ call, event: "Paid", receipt: receipt(logs), transaction, account })
  assert.deepEqual(interpret([paymentLog]), { payee, amount: "20" })
  assert.equal(interpret([{ ...paymentLog, address: account }]), undefined)
  assert.equal(interpret([]), undefined)
  assert.throws(() => interpret([paymentLog, paymentLog]), /multiple/)
  assert.throws(() => interpret([{ ...paymentLog, data: "0x" }]))
  assert.throws(() => interpret([{ ...paymentLog, topics: [...paymentLog.topics, hash] }]), /topic count/)
  assert.throws(() => interpret([{ ...paymentLog, data: `${paymentLog.data}${"00".repeat(32)}` }]), /noncanonical/)
  assert.throws(() => interpret([{ ...paymentLog, topics: [paymentLog.topics[0]!, `0x01${paymentLog.topics[1]!.slice(4)}`] }]))
})

test("absence cannot mean zero for a wallet cancellation or a mismatched receipt", () => {
  for (const change of [{ to: account }, { input: "0x" }, { from: payee }, { value: 1n }, { blockHash: hash }, { hash: blockHash }]) {
    assert.throws(() => interpretCamReceipt({ call, event: "Paid", receipt: receipt([]), transaction: { ...transaction, ...change } as CamMinedTransaction, account }), /does not match/)
  }
})

test("receipt event admission rejects ambiguous or unrecoverable declarations", () => {
  const declarations: readonly Abi[] = [
    parseAbi(["event Paid(string indexed payee, uint256 amount)"]),
    [{ type: "event", name: "Paid", anonymous: true, inputs: [] }],
    [...parseAbi(["event Paid(uint256 amount)"]), ...parseAbi(["event Paid(address payee)"])],
  ]
  for (const events of declarations) assert.throws(() => receiptEventAbi({ ...call, abi: events }, "Paid"))
})

test("a same-call speedup is interpreted using its actual mined hash", () => {
  const replacement = `0x${"ef".repeat(32)}` as const
  assert.deepEqual(interpretCamReceipt({ call, event: "Paid", receipt: { ...receipt([paymentLog]), transactionHash: replacement }, transaction: { ...transaction, hash: replacement }, account }), { payee, amount: "20" })
})

test("review reads and simulates at the captured block and rejects a changed anchor", async () => {
  const blocks: unknown[] = []
  const requests: unknown[] = []
  const client = {
    getChainId: async () => 31337,
    getBlock: async (request: unknown) => { blocks.push(request); return { number: 7n, hash: blockHash } },
    readContract: async (request: unknown) => { requests.push(request); return payee },
    simulateContract: async (request: unknown) => { requests.push(request); return { result: 30n } },
  }
  const options = { publicClient: client, account, call, read: { namespace: "contracts.Payment", function: "position", args: {} }, context: { host: { chainId: "eip155:31337", address }, inputs: {}, outputs: [] }, contracts: { "contracts.Payment": { address, abi } } } as const
  assert.deepEqual(await reviewCamContractCall(options), { blockNumber: "7", values: [{ read: [payee], simulation: ["30"] }] })
  assert.deepEqual(blocks, [{}, { blockNumber: 7n }])
  for (const request of requests) assert.equal((request as { blockNumber: bigint }).blockNumber, 7n)
  let reads = 0
  client.getBlock = async () => ({ number: 7n, hash: ++reads === 1 ? blockHash : hash })
  await assert.rejects(reviewCamContractCall(options), /observed block changed/)
})
