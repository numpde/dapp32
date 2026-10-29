import assert from "node:assert/strict"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { execFile } from "node:child_process"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { createPublicClient, createWalletClient, decodeEventLog, http, keccak256, parseAbiItem, toEventSelector, sha256, stringToBytes, type Address, type Hex } from "viem"
import { privateKeyToAccount } from "viem/accounts"
import { createHttpCamPublicClient, requireEvmAddress, sendCamContractCall, simulateCamContractCall } from "../../packages/cam-evm-viem/dist/index.js"
import { createCamViewerSession } from "../../packages/cam-viewer/dist/index.js"
import { resolvedUiButtons } from "../../packages/cam-screen/dist/index.js"
import { createCamResourceLoader, isRecordObject, parseJsonBytes, requireHttpURL, toInertValue, type InertRecord } from "../../packages/cam-protocol/dist/index.js"
import { discoverCustomers, runRefundBatch, type Position, type Report } from "../pay-to-play-refunds/core.ts"
import { hashInvoice, voucherForInvoice } from "../pay-to-play-vouchers/protocol.ts"
import { requiredEnv } from "../input.ts"

let phase = "configuration"
function record(value: unknown): Record<string, unknown> {
  assert(isRecordObject(value))
  return value
}
const inert = (value: Record<string, unknown>) => toInertValue(value) as InertRecord

async function main() {
  // This test inherits the existing disposable scenario's fixture accounts.
  // It cannot be pointed at an operator chain or an arbitrary remote RPC.
  const rpcURL = requireHttpURL(requiredEnv(process.env, "PAY_TO_PLAY_SCENARIO_RPC_URL"), "fixture RPC")
  assert.equal(rpcURL.protocol, "http:")
  assert(["pay-to-play-anvil", "127.0.0.1", "localhost", "[::1]"].includes(new URL(rpcURL.href).hostname))
  const broadcast = record(parseJsonBytes(new Uint8Array(readFileSync(requiredEnv(process.env, "PAY_TO_PLAY_SCENARIO_BROADCAST_PATH")))))
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
  const accounts = Object.fromEntries(roles.map(role => [role, privateKeyToAccount(requiredEnv(process.env, `PAY_TO_PLAY_${role.toUpperCase()}_PRIVATE_KEY`) as Hex)])) as Record<Role, ReturnType<typeof privateKeyToAccount>>
  const chain = { id: 31337, name: "Disposable recovery fixture", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [rpcURL.href] } } }
  const client = createPublicClient({ chain, transport: http(rpcURL.href, { timeout: 10_000, retryCount: 0 }) })
  assert.equal(await client.getChainId(), 31337)
  const session = createCamViewerSession({
    publicClient: createHttpCamPublicClient({ rpcURL: rpcURL.href }),
    host: { chainId: "eip155:31337", address: host }, account: { address: accounts.admin.address }, inputs: inert({}),
    loadResource: createCamResourceLoader({ originInput: requiredEnv(process.env, "PAY_TO_PLAY_SCENARIO_RESOURCE_ORIGIN"), originLabel: "PAY_TO_PLAY_SCENARIO_RESOURCE_ORIGIN", fetchResource: fetch, loadFailurePrefix: "Recovery fixture CAM resource" }),
  })
  await session.load()
  function view() { return record(session.snapshot().values?.[0]) }
  async function open(role: Role, customer: Address, id: string, recovery: boolean) {
    await session.setAccount({ address: accounts[role].address })
    await session.navigate(recovery ? "recovery" : "position", inert({ customer, channelId: id }))
    assert.equal(String(view().customer).toLowerCase(), customer.toLowerCase())
    assert.equal(view().channelId, id)
  }
  function button(route: string, disabled: boolean) {
    const found = resolvedUiButtons(session.snapshot().resolvedUi!).filter(value => value.call.function === route)
    assert.equal(found.length, 1, `${route} must be present exactly once`)
    assert.equal(found[0]!.disabled === true, disabled, `${route} availability`)
    return found[0]!
  }
  async function write(role: Role, route: string, state: Record<string, unknown>) {
    phase = route
    session.updateState(inert(state))
    const result = await session.dispatchAction(button(route, false))
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
  const COLLECTED = parseAbiItem("event VoucherCollected(address indexed customer,uint256 indexed channelId,address indexed payee,uint256 amount,uint256 voucherPaid,bytes32 invoiceHash)")
  async function create() {
    await open("admin", accounts.admin.address, "0", false)
    await session.navigate("choosePosition", inert({ customer: accounts.admin.address, channelId: "0" }))
    const receipt = await write("admin", "createChannel", { newPayee: accounts.payee.address, newChannelCollector: accounts.relayer.address, newClaimPeriod: "60" })
    const logs = receipt.logs.filter(log => log.address.toLowerCase() === payments.toLowerCase() && log.topics[0] === toEventSelector(CREATED))
    assert.equal(logs.length, 1)
    return decodeEventLog({ abi: [CREATED], eventName: "ChannelCreated", data: logs[0]!.data, topics: logs[0]!.topics }).args.channelId.toString()
  }
  async function warp(timestamp: bigint) {
    phase = "fixture time"
    assert.equal(await client.getChainId(), 31337)
    const current = (await client.getBlock()).timestamp
    assert(timestamp > current)
    // Explicit fixture-only method; production worker never calls time controls.
    const response = await fetch(rpcURL.href, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "evm_setNextBlockTimestamp", params: [Number(timestamp)] }), signal: AbortSignal.timeout(10_000) })
    assert(response.ok)
    assert.equal(record(await response.json()).error, undefined)
    const mined = await fetch(rpcURL.href, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "evm_mine", params: [] }), signal: AbortSignal.timeout(10_000) })
    assert(mined.ok)
    assert.equal(record(await mined.json()).error, undefined)
    await session.refresh()
  }
  async function sign(id: string, total: bigint, previousTotal: bigint) {
    const now = (await client.getBlock()).timestamp
    const invoice = {
      version: "1", purchaseId: sha256(stringToBytes(`recovery fixture:${id}:${total}`)),
      merchant: accounts.payee.address, customer: accounts.customer.address,
      chainId: "31337", paymentContract: payments, channelId: id,
      previousTotal: previousTotal.toString(), cumulativeTotal: total.toString(),
      acceptBefore: (now + 3600n).toString(), termsHash: sha256(stringToBytes("recovery fixture terms")),
    }
    return {
      cumulativeTotal: total.toString(), maxAmount: total.toString(), invoiceHash: hashInvoice(invoice),
      signature: await accounts.relayer.signTypedData(voucherForInvoice(invoice)),
    }
  }

  const id = await create()
  await open("customer", accounts.customer.address, id, false)
  await write("customer", "registerVoucherKey", { newVoucherKey: accounts.relayer.address })
  await write("customer", "fund", { fundAmount: "100" })
  const firstDeadline = BigInt(String(view().refundAt))
  assert.equal(firstDeadline - (await client.getBlock()).timestamp, 31536060n)
  await warp((await client.getBlock()).timestamp + 10n)
  await open("customer", accounts.customer.address, id, true)
  await write("customer", "renewPosition", {})
  assert(BigInt(String(view().refundAt)) >= firstDeadline + 10n)
  const renewed = view().refundAt
  await write("customer", "setRefundRecipient", { newRefundRecipient: accounts.admin.address })
  assert.equal(view().refundAt, renewed)
  const signed = await sign(id, 30n, 0n)
  const outstanding = await sign(id, 100n, 30n)
  await open("relayer", accounts.customer.address, id, true)
  button("closePosition", true)
  button("closeChannel", true)
  button("setRefundRecipient", true)
  await open("payee", accounts.customer.address, id, true)
  await write("payee", "closePosition", {})
  assert.equal(Number(view().phase), 1)
  const deadline = BigInt(String(view().refundAt))
  button("renewPosition", true)
  button("refund", true)
  await open("customer", accounts.customer.address, id, false)
  button("fund", true)
  button("setWithdrawal", true)
  await open("relayer", accounts.customer.address, id, false)
  const collection = await write("relayer", "collect", signed)
  const collectionLogs = collection.logs.filter(log => log.address.toLowerCase() === payments.toLowerCase())
  assert.equal(collectionLogs.length, 1)
  const firstCollection = decodeEventLog({ abi: [COLLECTED], ...collectionLogs[0]! }).args
  assert.equal(firstCollection.invoiceHash, signed.invoiceHash)
  assert.equal(firstCollection.amount, 30n)
  assert.equal(view().balance, "70")
  await warp(deadline)
  button("collect", true)
  await open("relayer", accounts.customer.address, id, true)
  const recipientBefore = await client.getBalance({ address: accounts.admin.address })
  await write("relayer", "refund", {})
  assert.equal(await client.getBalance({ address: accounts.admin.address }), recipientBefore + 70n)
  assert.equal(view().balance, "0")
  assert.equal(view().voucherPaid, "30")
  assert.equal(view().scheduledRefundAt, "0")
  assert.equal(String(view().voucherKey).toLowerCase(), accounts.relayer.address.toLowerCase())
  await open("customer", accounts.customer.address, id, false)
  await write("customer", "fund", { fundAmount: "50" })
  // The full collateral refund did not cancel unpaid capacity in the earlier invoice voucher.
  await open("relayer", accounts.customer.address, id, false)
  const retry = await write("relayer", "collect", outstanding)
  const retryLogs = retry.logs.filter(log => log.address.toLowerCase() === payments.toLowerCase())
  assert.equal(retryLogs.length, 1)
  const retried = decodeEventLog({ abi: [COLLECTED], ...retryLogs[0]! }).args
  assert.equal(retried.invoiceHash, outstanding.invoiceHash)
  assert.equal(retried.amount, 50n)
  assert.equal(retried.voucherPaid, 80n)
  assert.equal(view().balance, "0")
  await open("customer", accounts.customer.address, id, false)
  await write("customer", "fund", { fundAmount: "50" })
  const annual = BigInt(String(view().refundAt))
  await warp(annual - 60n)
  button("fund", true)
  await open("customer", accounts.customer.address, id, true)
  button("renewPosition", true)
  button("refund", true)
  await warp(annual)
  await open("relayer", accounts.customer.address, id, true)
  await write("relayer", "refund", {})
  assert.equal(view().balance, "0")
  assert.equal(view().voucherPaid, "80")

  // Create two backed positions, one reached ONLY through an incoming move.
  const retired = await create()
  await open("customer", accounts.customer.address, retired, false)
  await write("customer", "fund", { fundAmount: "80" })
  await open("relayer", accounts.relayer.address, "0", false)
  await write("relayer", "fund", { fundAmount: "40" })
  await write("relayer", "requestWithdrawal", { withdrawAmount: "40" })
  await warp(BigInt(String(view().readyAt)))
  await write("relayer", "move", { targetId: retired })
  await open("admin", accounts.customer.address, retired, true)
  await write("admin", "closeChannel", {})
  assert.equal(view().escrowTotal, "120")
  const closing = BigInt(String(view().closeAt))
  await open("customer", accounts.customer.address, retired, false)
  button("fund", true)
  await warp(closing)
  await open("payee", accounts.customer.address, retired, true)
  button("closeChannel", true)
  button("refund", false)

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
    sendRefund: async () => { throw new Error("Core planning must not send") },
  }
  const plan = await runRefundBatch(customers, adapter, { execute: false, maxTransactions: 1, report })
  assert.equal(plan.due, 2)
  assert.equal(plan.submitted, 0)
  // Exercise the actual file-backed CLI adapter, including its journal and
  // EIP-1559 broadcast path, using only this disposable chain and fixture key.
  const directory = mkdtempSync(join(tmpdir(), "recovery-worker-"))
  try {
    const configFile = join(directory, "config.json")
    const rpcFile = join(directory, "rpc")
    const keyFile = join(directory, "key")
    const code = await client.getBytecode({ address: payments })
    assert(code && code !== "0x")
    writeFileSync(configFile, JSON.stringify({
      chainId: "31337", payment: payments, codeHash: keccak256(code), channelId: retired,
      fromBlock: "0", toBlock: (await client.getBlockNumber({ cacheTime: 0 })).toString(),
      confirmations: 1, blockChunk: 5, maxCustomers: 10, maxTransactions: 1,
      gasLimit: "300000", maxFeePerGas: "10000000000", maxPriorityFeePerGas: "1000000000",
    }), { mode: 0o600 })
    writeFileSync(rpcFile, rpcURL.href, { mode: 0o600 })
    writeFileSync(keyFile, requiredEnv(process.env, "PAY_TO_PLAY_PAYEE_PRIVATE_KEY"), { mode: 0o600 })
    async function cli(execute: boolean) {
      phase = "refund CLI"
      const env: NodeJS.ProcessEnv = { REFUND_CONFIG_FILE: configFile, RPC_URL_FILE: rpcFile, REFUND_EXECUTE: execute ? "YES" : "NO" }
      if (execute) { env.REFUND_PRIVATE_KEY_FILE = keyFile; env.REFUND_STATE_DIR = directory }
      const result = await new Promise<{ code: number; stdout: string }>(resolve => {
        execFile(process.execPath, ["--experimental-strip-types", fileURLToPath(new URL("../pay-to-play-refunds/runner.ts", import.meta.url))],
          { env, timeout: 90_000, maxBuffer: 262_144 }, (error, stdout) => {
            resolve({ code: error ? (typeof error.code === "number" ? error.code : -1) : 0, stdout })
          })
      })
      const events = result.stdout.trim().split("\n").filter(Boolean).map(line => record(JSON.parse(line)))
      const batches = events.filter(event => event.event === "batch")
      assert.equal(batches.length, 1, "CLI must report one bounded batch")
      return { code: result.code, batch: batches[0]! }
    }
    const dry = await cli(false)
    assert.equal(dry.code, 0)
    assert.equal(dry.batch.due, 2)
    assert.equal(dry.batch.submitted, 0)
    const first = await cli(true)
    assert.equal(first.code, 2)
    assert.equal(first.batch.confirmed, 1)
    assert.equal(first.batch.deferred, 1)
    const second = await cli(true)
    assert.equal(second.code, 0)
    assert.equal(second.batch.confirmed, 1)
    const third = await cli(true)
    assert.equal(third.code, 0)
    assert.equal(third.batch.due, 0)
    const journal = record(JSON.parse(readFileSync(join(directory, "refunds.json"), "utf8")))
    assert.equal(journal.pending, null)
    assert.equal(record(journal.lastReceipt).status, "confirmed")
    // A confirmed receipt plus a failed durable write is fatal, not an unknown receipt.
    const receipt = record(journal.lastReceipt)
    writeFileSync(join(directory, "refunds.json"), JSON.stringify({ ...journal, pending: {
      customer: receipt.customer, hash: receipt.hash, nonce: receipt.nonce,
    } }), { mode: 0o600 })
    const fault = join(directory, "receipt-write-fault.mjs")
    writeFileSync(fault, `import fs from 'node:fs';import {syncBuiltinESMExports} from 'node:module';
const rename=fs.renameSync;fs.renameSync=(source,target)=>{if(target.endsWith('/refunds.json'))throw Object.assign(new Error('SECRET_FAULT_BODY'),{code:'EACCES',syscall:'rename'});return rename(source,target)};syncBuiltinESMExports();`)
    const failed = await new Promise<{ code: number; stdout: string; stderr: string }>(resolve => {
      execFile(process.execPath, ["--import", fault, "--experimental-strip-types", fileURLToPath(new URL("../pay-to-play-refunds/runner.ts", import.meta.url))], {
        env: { REFUND_CONFIG_FILE: configFile, RPC_URL_FILE: rpcFile, REFUND_EXECUTE: "YES", REFUND_PRIVATE_KEY_FILE: keyFile, REFUND_STATE_DIR: directory },
        timeout: 90_000, maxBuffer: 262_144,
      }, (error, stdout, stderr) => resolve({ code: error ? (typeof error.code === "number" ? error.code : -1) : 0, stdout, stderr }))
    })
    assert.equal(failed.code, 1, "confirmed receipt persistence failure must be fatal")
    assert.match(failed.stderr, /rename.*EACCES/)
    assert(!failed.stderr.includes("SECRET_FAULT_BODY"))
    assert(!failed.stdout.includes('"event":"pending"'), "known receipt must not be reported as uncertain")
    assert.equal(record(JSON.parse(readFileSync(join(directory, "refunds.json"), "utf8"))).pending !== null, true)
  } finally { rmSync(directory, { recursive: true, force: true }) }
  await open("customer", accounts.customer.address, retired, false)
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
