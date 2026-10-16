import assert from "node:assert/strict"
import { AssertionError } from "node:assert"
import { readFileSync } from "node:fs"
import { createPublicClient, createWalletClient, hashTypedData, http } from "viem"
import type { Address, Hex } from "viem"
import { privateKeyToAccount } from "viem/accounts"
import { createHttpCamPublicClient, requireEvmAddress, sendCamContractCall, simulateCamContractCall } from "../../packages/cam-evm-viem/dist/index.js"
import { createCamViewerSession } from "../../packages/cam-viewer/dist/index.js"
import type { CamViewerLoadedSnapshot } from "../../packages/cam-viewer/dist/index.js"
import { resolvedUiButtons } from "../../packages/cam-screen/dist/index.js"
import { createSameOriginHttpResourceLoader, isRecordObject, parseJsonBytes, toInertValue } from "../../packages/cam-protocol/dist/index.js"
import type { InertRecord } from "../../packages/cam-protocol/dist/index.js"

const roles = ["admin", "customer", "relayer", "payee"] as const
type Role = typeof roles[number]
const RECEIPT_TIMEOUT = 20_000

async function main(): Promise<void> {
  const rpcURL = requiredEnv("PAY_TO_PLAY_SCENARIO_RPC_URL")
  const broadcast = object(parseJsonBytes(new Uint8Array(readFileSync(requiredEnv("PAY_TO_PLAY_SCENARIO_BROADCAST_PATH")))))
  assert.ok(Array.isArray(broadcast.transactions), "Forge broadcast must contain transactions")
  function deployed(name: string): Address {
    const matches = (broadcast.transactions as unknown[]).filter((tx) => isRecordObject(tx) && tx.contractName === name && tx.transactionType === "CREATE")
    assert.equal(matches.length, 1, `fixture must deploy one ${name}`)
    const address = object(matches[0]).contractAddress
    assert.equal(typeof address, "string", `${name} address must be a string`)
    return requireEvmAddress(address as string, `${name} address`)
  }
  const host = deployed("CamRoot")
  const payments = deployed("PayToPlay")
  const accounts = Object.fromEntries(roles.map((role) => {
    const key = requiredEnv(`PAY_TO_PLAY_${role.toUpperCase()}_PRIVATE_KEY`)
    assert.match(key, /^0x[0-9a-fA-F]{64}$/, "fixture key must have 32 bytes")
    return [role, privateKeyToAccount(key as Hex)]
  })) as Record<Role, ReturnType<typeof privateKeyToAccount>>
  const chain = {
    id: 31337,
    name: "Payment channels local fixture",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [rpcURL] } },
  }
  const publicClient = createPublicClient({ chain, transport: http(rpcURL) })
  assert.equal(await publicClient.getChainId(), 31337)
  const session = createCamViewerSession({
    publicClient: createHttpCamPublicClient({ rpcURL }),
    host: { chainId: "eip155:31337", address: host },
    account: { address: accounts.admin.address },
    inputs: inert({}),
    loadResource: createSameOriginHttpResourceLoader({
      originInput: requiredEnv("PAY_TO_PLAY_SCENARIO_RESOURCE_ORIGIN"),
      originLabel: "PAY_TO_PLAY_SCENARIO_RESOURCE_ORIGIN",
      fetchResource: fetch,
      loadFailurePrefix: "Cannot load the payment-channel fixture CAM resource",
    }),
  })
  await session.load()

  function loaded(): CamViewerLoadedSnapshot {
    const snapshot = session.snapshot()
    assert.ok(snapshot.resolvedUi && snapshot.values, "CAM position must be loaded")
    return snapshot as CamViewerLoadedSnapshot
  }
  function view(): Record<string, unknown> { return object(loaded().values[0]) }
  function action(route: string, disabled: boolean) {
    const matches = resolvedUiButtons(loaded().resolvedUi).filter((button) => button.call.function === route)
    assert.equal(matches.length, 1, `${route} must stay visible exactly once`)
    const button = matches[0]!
    assert.equal(button.disabled === true, disabled, `${route} availability`)
    return button
  }
  async function position(role: Role, channelId: string) {
    await session.setAccount({ address: accounts[role].address })
    await session.navigate("position", inert({ customer: accounts.customer.address, channelId }))
  }
  async function write(role: Role, route: string, state: Record<string, unknown>) {
    const inspected = view()
    await session.setAccount({ address: accounts[role].address })
    await session.navigate("position", inert({ customer: inspected.customer, channelId: inspected.channelId }))
    session.updateState(inert(state))
    const prepared = await session.dispatchAction(action(route, false))
    assert.equal(prepared.type, "contractCall")
    if (prepared.type !== "contractCall") throw new Error(`Cannot execute ${route}: CAM did not prepare a contract call`)
    assert.equal(prepared.call.address.toLowerCase(), payments.toLowerCase(), "CAM binding must select the deployed payment contract")
    if (route === "createChannel") {
      await assert.rejects(() => simulateCamContractCall({ publicClient, account: accounts.relayer.address, call: prepared.call }), "non-admin must fail even with the rendered admin call")
    }
    await simulateCamContractCall({ publicClient, account: accounts[role].address, call: prepared.call })
    const walletClient = createWalletClient({ account: accounts[role], chain, transport: http(rpcURL) })
    const hash = await sendCamContractCall({ walletClient, chain, call: prepared.call })
    const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: RECEIPT_TIMEOUT })
    assert.equal(receipt.status, "success", `${route} must succeed`)
    assert.equal(prepared.call.then.namespace, "routes")
    await session.navigate(prepared.call.then.function, prepared.call.then.args)
    process.stdout.write(`${JSON.stringify({ event: "write_ok", role, route, hash })}\n`)
  }
  async function mature() {
    const deadline = BigInt(String(view().readyAt))
    const current = (await publicClient.getBlock()).timestamp
    if (deadline > current) await localRpc(rpcURL, "evm_increaseTime", [Number(deadline - current)])
    await localRpc(rpcURL, "evm_mine", [])
    await session.refresh()
  }
  async function voucher(total: bigint) {
    const typed = {
      domain: { name: "PayToPlay", version: "1", chainId: 31337, verifyingContract: payments },
      types: { Voucher: [
        { name: "customer", type: "address" },
        { name: "channelId", type: "uint256" },
        { name: "cumulativeTotal", type: "uint256" },
      ] },
      primaryType: "Voucher" as const,
      message: { customer: accounts.customer.address, channelId: 1n, cumulativeTotal: total },
    }
    const signature = await accounts.customer.signTypedData(typed)
    session.updateState(inert({ cumulativeTotal: total.toString() }))
    const read = await session.dispatchAction(action("voucherDigest", false))
    assert.equal(read.type, "navigated")
    assert.equal(loaded().values[0], hashTypedData(typed), "CAM digest and standard typed-data hashing must agree")
    await position("customer", "1")
    return signature
  }
  async function collect(total: string, signature: Hex) {
    await write("relayer", "collect", { cumulativeTotal: total, signature })
  }

  action("createChannel", false)
  action("collect", true)
  await write("admin", "createChannel", { newPayee: accounts.payee.address, newClaimPeriod: "60" })
  await position("customer", "1")
  assert.equal(String(view().payee).toLowerCase(), accounts.payee.address.toLowerCase())
  action("createChannel", true)
  action("setPayee", true)
  action("withdraw", true)
  await write("customer", "fund", { fundAmount: "100" })
  assert.equal(view().effectiveBalance, "100")
  // Y assigns cumulative totals for two purchases (API A: 60, API B: 40).
  // Signing these assigned totals does not implement Y's durable purchase ledger.
  const signatures = await Promise.all([60n, 100n].map((total) => accounts.customer.signTypedData({
    domain: { name: "PayToPlay", version: "1", chainId: 31337, verifyingContract: payments },
    types: { Voucher: [{ name: "customer", type: "address" }, { name: "channelId", type: "uint256" }, { name: "cumulativeTotal", type: "uint256" }] },
    primaryType: "Voucher",
    message: { customer: accounts.customer.address, channelId: 1n, cumulativeTotal: total },
  })))
  await write("customer", "requestWithdrawal", { withdrawAmount: "80" })
  assert.equal(view().effectiveBalance, "20")
  action("requestWithdrawal", true)

  await collect("60", signatures[0]!)
  assert.equal(view().balance, "40")
  assert.equal(view().voucherPaid, "60")
  assert.equal(view().requestedAmount, "80")
  await position("relayer", "1")
  action("requestWithdrawal", true)
  action("setWithdrawal", true)
  action("move", true)
  await position("admin", "1")
  await write("admin", "setPayee", { replacementPayee: accounts.admin.address })
  await mature()
  await write("relayer", "withdraw", {})
  assert.equal(view().balance, "0")
  assert.equal(view().requestedAmount, "0", "partial withdrawal clears request")
  assert.equal(view().readyAt, "0")
  await position("customer", "1")
  await write("customer", "fund", { fundAmount: "30" })
  const recipientBefore = await publicClient.getBalance({ address: accounts.admin.address })
  await collect("100", signatures[1]!)
  assert.equal(await publicClient.getBalance({ address: accounts.admin.address }), recipientBefore + 30n)
  assert.equal(view().voucherPaid, "90")
  await position("customer", "1")
  await write("customer", "fund", { fundAmount: "20" })
  await collect("100", signatures[1]!)
  assert.equal(view().voucherPaid, "100")
  assert.equal(view().balance, "10")
  await collect("60", signatures[0]!)
  assert.equal(view().balance, "10", "older voucher must not repay")
  await position("customer", "1")
  const larger = await voucher(150n)
  await collect("150", larger)
  assert.equal(view().voucherPaid, "110")
  await position("customer", "1")
  await write("customer", "fund", { fundAmount: "40" })
  await collect("150", larger)
  assert.equal(view().voucherPaid, "150")
  assert.equal(view().balance, "0")

  await position("customer", "1")
  await write("customer", "fund", { fundAmount: "100" })
  await write("customer", "requestWithdrawal", { withdrawAmount: "40" })
  const firstReady = BigInt(String(view().readyAt))
  await localRpc(rpcURL, "evm_increaseTime", [10])
  await localRpc(rpcURL, "evm_mine", [])
  await write("customer", "setWithdrawal", { withdrawAmount: "100" })
  assert.equal(view().requestedAmount, "100")
  assert.equal(view().effectiveBalance, "0")
  assert.ok(BigInt(String(view().readyAt)) >= firstReady + 10n, "higher renewal starts a full new wait")
  action("withdraw", true)
  action("move", true)
  const renewedReady = view().readyAt
  await write("customer", "fund", { fundAmount: "10" })
  assert.equal(view().readyAt, renewedReady, "top-up preserves wait")
  const duringWait = await voucher(210n)
  await collect("210", duringWait)
  assert.equal(view().balance, "50")
  assert.equal(view().effectiveBalance, "0")
  assert.equal(view().readyAt, renewedReady)
  await position("customer", "1")
  await mature()
  await write("customer", "move", { targetId: "0" })
  assert.equal(view().balance, "0")
  assert.equal(view().requestedAmount, "0")
  await position("customer", "0")
  assert.equal(view().balance, "50")
  action("collect", true)
  await write("customer", "requestWithdrawal", { withdrawAmount: "50" })
  await mature()
  await write("relayer", "withdraw", {})
  assert.equal(view().balance, "0")
  await position("customer", "1")
  await write("customer", "fund", { fundAmount: "20" })
  await write("customer", "requestWithdrawal", { withdrawAmount: "20" })
  const emptyingVoucher = await voucher(230n)
  await collect("230", emptyingVoucher)
  assert.equal(view().balance, "0")
  await mature()
  await write("relayer", "withdraw", {})
  assert.equal(view().requestedAmount, "0", "zero-payment mature withdrawal consumes the request")
  assert.equal(view().readyAt, "0")
  assert.equal(view().voucherPaid, "230")
  assert.equal(await publicClient.getBalance({ address: payments }), 0n)
  await assert.rejects(() => session.navigate("position", inert({ customer: accounts.customer.address, channelId: "999" })), "undefined channel must fail")
  process.stdout.write(`${JSON.stringify({ event: "ok", host, payments, voucherPaid: "230", contractBalance: "0" })}\n`)
}

function requiredEnv(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`Cannot run the local payment-channel scenario: ${name} is required`)
  return value
}
function object(value: unknown): Record<string, unknown> {
  assert.ok(isRecordObject(value), "CAM/Forge value must be an object")
  return value
}
function inert(value: Record<string, unknown>): InertRecord {
  return toInertValue(value) as InertRecord
}
async function localRpc(url: string, method: string, params: unknown[]) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(10_000),
  })
  assert.ok(response.ok, `fixture RPC ${method} HTTP status`)
  const result = object(await response.json())
  assert.equal(result.error, undefined, `fixture RPC ${method} must succeed`)
}

main().catch((error: unknown) => {
  // RPC errors can embed voucher signatures in calldata. Keep diagnostics safe;
  // the last write_ok route identifies the failing workflow step.
  process.stderr.write(error instanceof AssertionError
    ? `Payment-channel scenario assertion failed: ${error.message}\n`
    : "Payment-channel scenario failed; inspect the last completed CAM route and fixture service logs.\n")
  process.exitCode = 1
})
