import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createPublicClient, createWalletClient, decodeEventLog, http, parseAbiItem, type Address, type Hex } from "viem"
import { privateKeyToAccount } from "viem/accounts"
import { createHttpCamPublicClient, requireEvmAddress, sendCamContractCall, simulateCamContractCall } from "@cam/evm-viem"
import { createCamViewerSession } from "@cam/viewer"
import { resolvedUiButtons } from "@cam/screen"
import { createSameOriginHttpResourceLoader, isRecordObject, parseJsonBytes, requireHttpURL, toInertValue, type InertRecord } from "@cam/protocol"
import { discoverCustomers, runRefundBatch, type Position, type Report } from "../pay-to-play-refunds/core.ts"

let phase = "configuration"
function required(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`Missing ${name}`)
  return value
}
function record(value: unknown): Record<string, unknown> {
  assert(isRecordObject(value))
  return value
}
const inert = (value: Record<string, unknown>) => toInertValue(value) as InertRecord

async function main() {
  // This test inherits the existing disposable scenario's fixture accounts.
  // It cannot be pointed at an operator chain or an arbitrary remote RPC.
  const rpcURL = requireHttpURL(required("PAY_TO_PLAY_SCENARIO_RPC_URL"), "fixture RPC")
  assert.equal(rpcURL.protocol, "http:")
  assert(["pay-to-play-anvil", "127.0.0.1", "localhost", "[::1]"].includes(rpcURL.hostname))
  const broadcast = record(parseJsonBytes(new Uint8Array(readFileSync(required("PAY_TO_PLAY_SCENARIO_BROADCAST_PATH")))))
  assert(Array.isArray(broadcast.transactions))
  function deployed(name: string): Address {
    const found = (broadcast.transactions as unknown[]).filter(value => isRecordObject(value) && value.contractName === name && value.transactionType === "CREATE")
    assert.equal(found.length, 1)
    const address = record(found[0]).contractAddress
    assert.equal(typeof address, "string")
    return requireEvmAddress(address as string, name)
  }
  const host = deployed("CamRoot")
  const payments = deployed("PayToPlay")
  const roles = ["admin", "customer", "relayer", "payee"] as const
  type Role = typeof roles[number]
  const accounts = Object.fromEntries(roles.map(role => [role, privateKeyToAccount(required(`PAY_TO_PLAY_${role.toUpperCase()}_PRIVATE_KEY`) as Hex)])) as Record<Role, ReturnType<typeof privateKeyToAccount>>
  const chain = { id: 31337, name: "Disposable recovery fixture", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [rpcURL.href] } } }
  const client = createPublicClient({ chain, transport: http(rpcURL.href, { timeout: 10_000, retryCount: 0 }) })
  assert.equal(await client.getChainId(), 31337)
  const session = createCamViewerSession({
    publicClient: createHttpCamPublicClient({ rpcURL: rpcURL.href }),
    host: { chainId: "eip155:31337", address: host }, account: { address: accounts.admin.address }, inputs: inert({}),
    loadResource: createSameOriginHttpResourceLoader({ originInput: required("PAY_TO_PLAY_SCENARIO_RESOURCE_ORIGIN"), originLabel: "PAY_TO_PLAY_SCENARIO_RESOURCE_ORIGIN", fetchResource: fetch, loadFailurePrefix: "Recovery fixture CAM resource" }),
  })
  await session.load()
  function view() { return record(session.snapshot().values?.[0]) }
  async function open(role: Role, customer: Address, id: string, recovery = false) {
    await session.setAccount({ address: accounts[role].address })
    await session.navigate(recovery ? "recovery" : "position", inert({ customer, channelId: id }))
    assert.equal(String(view().customer).toLowerCase(), customer.toLowerCase())
    assert.equal(view().channelId, id)
  }
  function button(route: string, disabled = false) {
    const found = resolvedUiButtons(session.snapshot().resolvedUi!).filter(value => value.call.function === route)
    assert.equal(found.length, 1, `${route} must be present exactly once`)
    assert.equal(found[0]!.disabled === true, disabled, `${route} availability`)
    return found[0]!
  }
  async function write(role: Role, route: string, state: Record<string, unknown> = {}) {
    phase = route
    session.updateState(inert(state))
    const result = await session.dispatchAction(button(route))
    assert.equal(result.type, "contractCall")
    if (result.type !== "contractCall") throw new Error("Expected write")
    assert.equal(result.call.address.toLowerCase(), payments.toLowerCase())
    await simulateCamContractCall({ publicClient: client, account: accounts[role].address, call: result.call })
    const wallet = createWalletClient({ account: accounts[role], chain, transport: http(rpcURL.href, { timeout: 10_000, retryCount: 0 }) })
    const hash = await sendCamContractCall({ walletClient: wallet, chain, call: result.call })
    const receipt = await client.waitForTransactionReceipt({ hash, timeout: 20_000 })
    assert.equal(receipt.status, "success")
    await session.navigate(result.call.then.function, result.call.then.args)
    return receipt
  }
  const CREATED = parseAbiItem("event ChannelCreated(uint256 indexed channelId,address payee,uint64 claimPeriod)")
  async function create() {
    await open("admin", accounts.admin.address, "0")
    const receipt = await write("admin", "createChannel", { newPayee: accounts.payee.address, newClaimPeriod: "60" })
    const logs = receipt.logs.filter(log => log.address.toLowerCase() === payments.toLowerCase())
    assert.equal(logs.length, 1)
    return decodeEventLog({ abi: [CREATED], eventName: "ChannelCreated", data: logs[0]!.data, topics: logs[0]!.topics }).args.channelId.toString()
  }
  async function warp(timestamp: bigint) {
    phase = "fixture time"
    assert.equal(await client.getChainId(), 31337)
    const current = (await client.getBlock()).timestamp
    assert(timestamp > current)
    // Explicit fixture-only method; production worker never calls time controls.
    const response = await fetch(rpcURL, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "evm_setNextBlockTimestamp", params: [Number(timestamp)] }), signal: AbortSignal.timeout(10_000) })
    assert(response.ok)
    assert.equal(record(await response.json()).error, undefined)
    const mined = await fetch(rpcURL, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "evm_mine", params: [] }), signal: AbortSignal.timeout(10_000) })
    assert(mined.ok)
    assert.equal(record(await mined.json()).error, undefined)
    await session.refresh()
  }
  async function sign(id: string, total: bigint) {
    return accounts.relayer.signTypedData({
      domain: { name: "PayToPlay", version: "1", chainId: 31337, verifyingContract: payments },
      types: { Voucher: [{ name: "customer", type: "address" }, { name: "channelId", type: "uint256" }, { name: "cumulativeTotal", type: "uint256" }] },
      primaryType: "Voucher", message: { customer: accounts.customer.address, channelId: BigInt(id), cumulativeTotal: total },
    })
  }

  const id = await create()
  await open("customer", accounts.customer.address, id)
  await write("customer", "registerVoucherKey", { newVoucherKey: accounts.relayer.address })
  await write("customer", "fund", { fundAmount: "100" })
  const firstDeadline = BigInt(String(view().refundAt))
  assert.equal(firstDeadline - (await client.getBlock()).timestamp, 31536060n)
  await warp((await client.getBlock()).timestamp + 10n)
  await open("customer", accounts.customer.address, id, true)
  await write("customer", "renewPosition")
  assert(BigInt(String(view().refundAt)) >= firstDeadline + 10n)
  const renewed = view().refundAt
  await write("customer", "setRefundRecipient", { newRefundRecipient: accounts.admin.address })
  assert.equal(view().refundAt, renewed)
  const signature = await sign(id, 30n)
  await open("relayer", accounts.customer.address, id, true)
  button("closePosition", true)
  button("closeChannel", true)
  button("setRefundRecipient", true)
  await open("payee", accounts.customer.address, id, true)
  await write("payee", "closePosition")
  assert.equal(Number(view().phase), 1)
  const deadline = BigInt(String(view().refundAt))
  button("renewPosition", true)
  button("refund", true)
  await open("customer", accounts.customer.address, id)
  button("fund", true)
  button("setWithdrawal", true)
  await open("relayer", accounts.customer.address, id)
  await write("relayer", "collect", { cumulativeTotal: "30", signature })
  assert.equal(view().balance, "70")
  await warp(deadline)
  button("collect", true)
  await open("relayer", accounts.customer.address, id, true)
  const recipientBefore = await client.getBalance({ address: accounts.admin.address })
  await write("relayer", "refund")
  assert.equal(await client.getBalance({ address: accounts.admin.address }), recipientBefore + 70n)
  assert.equal(view().balance, "0")
  assert.equal(view().voucherPaid, "30")
  assert.equal(view().scheduledRefundAt, "0")
  assert.equal(String(view().voucherKey).toLowerCase(), accounts.relayer.address.toLowerCase())
  await open("customer", accounts.customer.address, id)
  await write("customer", "fund", { fundAmount: "50" })
  const annual = BigInt(String(view().refundAt))
  await warp(annual - 60n)
  button("fund", true)
  await open("customer", accounts.customer.address, id, true)
  button("renewPosition", true)
  button("refund", true)
  await warp(annual)
  await open("relayer", accounts.customer.address, id, true)
  await write("relayer", "refund")
  assert.equal(view().balance, "0")

  // Create two backed positions, one reached ONLY through an incoming move.
  const retired = await create()
  await open("customer", accounts.customer.address, retired)
  await write("customer", "fund", { fundAmount: "80" })
  await open("relayer", accounts.relayer.address, "0")
  await write("relayer", "fund", { fundAmount: "40" })
  await write("relayer", "requestWithdrawal", { withdrawAmount: "40" })
  await warp(BigInt(String(view().readyAt)))
  await write("relayer", "move", { targetId: retired })
  await open("admin", accounts.customer.address, retired, true)
  await write("admin", "closeChannel")
  assert.equal(view().escrowTotal, "120")
  const closing = BigInt(String(view().closeAt))
  await open("customer", accounts.customer.address, retired)
  button("fund", true)
  await warp(closing)
  await open("payee", accounts.customer.address, retired, true)
  button("closeChannel", true)
  button("refund")

  const FUNDED = parseAbiItem("event Funded(address indexed customer,uint256 indexed channelId,uint256 amount)")
  const MOVED = parseAbiItem("event Moved(address indexed customer,uint256 indexed sourceId,uint256 indexed targetId,uint256 amount)")
  const customers = await discoverCustomers(async (fromBlock, toBlock) => {
    const f = await client.getLogs({ address: payments, event: FUNDED, args: { channelId: BigInt(retired) }, fromBlock, toBlock, strict: true })
    const m = await client.getLogs({ address: payments, event: MOVED, args: { targetId: BigInt(retired) }, fromBlock, toBlock, strict: true })
    return [...f.map(log => log.args.customer), ...m.map(log => log.args.customer)]
  }, { fromBlock: 0n, toBlock: await client.getBlockNumber({ cacheTime: 0 }), blockChunk: 5, maxCustomers: 10 })
  assert.deepEqual(customers, [accounts.customer.address, accounts.relayer.address].map(address => address.toLowerCase()).sort())
  const report: Report = entry => { process.stdout.write(JSON.stringify({ test: "recovery", ...entry }) + "\n") }
  const adapter = {
    readPosition: async (customer: Address): Promise<Position> => {
      await open("payee", customer, retired, true)
      const v = view()
      return { balance: BigInt(String(v.balance)), scheduledRefundAt: BigInt(String(v.scheduledRefundAt)), requestedAmount: BigInt(String(v.requestedAmount)), refundAt: BigInt(String(v.refundAt)), refundRecipient: requireEvmAddress(String(v.refundRecipient), "refund recipient"), phase: Number(v.phase) }
    },
    sendRefund: async (customer: Address) => {
      await open("payee", customer, retired, true)
      const receipt = await write("payee", "refund")
      return { status: "confirmed" as const, hash: receipt.transactionHash }
    },
  }
  const plan = await runRefundBatch(customers, adapter, { execute: false, maxTransactions: 1, report })
  assert.equal(plan.due, 2)
  assert.equal(plan.submitted, 0)
  const first = await runRefundBatch(customers, adapter, { execute: true, maxTransactions: 1, report })
  assert.equal(first.confirmed, 1)
  assert.equal(first.deferred, 1)
  const second = await runRefundBatch(customers, adapter, { execute: true, maxTransactions: 1, report })
  assert.equal(second.confirmed, 1)
  const third = await runRefundBatch(customers, adapter, { execute: true, maxTransactions: 1, report })
  assert.equal(third.due, 0)
  await open("customer", accounts.customer.address, retired)
  assert.equal(view().escrowTotal, "0")
  button("fund", true)
  assert.equal(await client.getBalance({ address: payments }), 0n)
  process.stdout.write(JSON.stringify({ event: "ok", test: "recovery CAM and refund batches", channel: retired }) + "\n")
}

main().catch(() => {
  // Do not leak fixture signatures or SDK calldata through error rendering.
  process.stderr.write(`Recovery scenario failed during ${phase}.\n`)
  process.exitCode = 1
})
