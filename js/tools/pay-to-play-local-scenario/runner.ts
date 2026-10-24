import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createPublicClient, createWalletClient, decodeEventLog, hashTypedData, http, sha256, stringToBytes } from "viem"
import type { Address, Hex } from "viem"
import { privateKeyToAccount } from "viem/accounts"
import { createHttpCamPublicClient, requireEvmAddress, sendCamContractCall, simulateCamContractCall } from "../../packages/cam-evm-viem/dist/index.js"
import { createCamViewerSession, viewerErrorMessage } from "../../packages/cam-viewer/dist/index.js"
import type { CamViewerLoadedSnapshot } from "../../packages/cam-viewer/dist/index.js"
import { resolvedUiButtons } from "../../packages/cam-screen/dist/index.js"
import { createCamResourceLoader, isRecordObject, parseJsonBytes, toInertValue } from "../../packages/cam-protocol/dist/index.js"
import type { InertRecord } from "../../packages/cam-protocol/dist/index.js"
import { assertInvoiceAcceptance, hashInvoice, voucherForInvoice } from "../pay-to-play-vouchers/protocol.ts"
import { requiredEnv } from "../input.ts"

const roles = ["admin", "customer", "relayer", "payee"] as const
type Role = typeof roles[number]
const RECEIPT_TIMEOUT = 20_000

async function main(): Promise<void> {
  const rpcURL = requiredEnv(process.env, "PAY_TO_PLAY_SCENARIO_RPC_URL")
  const broadcast = object(parseJsonBytes(new Uint8Array(readFileSync(requiredEnv(process.env, "PAY_TO_PLAY_SCENARIO_BROADCAST_PATH")))))
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
    const key = requiredEnv(process.env, `PAY_TO_PLAY_${role.toUpperCase()}_PRIVATE_KEY`)
    assert.match(key, /^0x[0-9a-fA-F]{64}$/, "fixture key must have 32 bytes")
    return [role, privateKeyToAccount(key as Hex)]
  })) as Record<Role, ReturnType<typeof privateKeyToAccount>>
  // Public, unfunded voucher-only key for this disposable local fixture, never a live key.
  const voucherSigner = privateKeyToAccount(`0x${"55".repeat(32)}`)
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
    loadResource: createCamResourceLoader({
      originInput: requiredEnv(process.env, "PAY_TO_PLAY_SCENARIO_RESOURCE_ORIGIN"),
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
    if (route !== "createChannel") await session.navigate("position", inert({ customer: inspected.customer, channelId: inspected.channelId }))
    session.updateState(inert(state))
    const rendered = action(route, false)
    if (["registerVoucherKey", "fund", "requestWithdrawal", "setWithdrawal", "move"].includes(route)) {
      await assert.rejects(() => session.dispatchAction({ ...rendered, call: { ...rendered.call, args: inert({ ...rendered.call.args, customer: accounts.relayer.address }) } }), "sender-owned actions must reject an injected customer input")
    }
    const prepared = await session.dispatchAction(rendered)
    assert.equal(prepared.type, "contractCall")
    if (prepared.type !== "contractCall") throw new Error(`Cannot execute ${route}: CAM did not prepare a contract call`)
    assert.equal(prepared.call.address.toLowerCase(), payments.toLowerCase(), "CAM binding must select the deployed payment contract")
    if (route === "createChannel") {
      const nativeAsset = await publicClient.readContract({
        address: payments,
        abi: prepared.call.abi,
        functionName: "asset",
      })
      assert.equal(String(nativeAsset).toLowerCase(), "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee", "asset() must identify the deployed contract's native asset")
    }
    if (route === "fund") {
      const requestedAmount = BigInt(String(state.fundAmount))
      assert.equal(BigInt(String(prepared.call.args.amount)), requestedAmount, "fund ABI amount must match the requested amount")
      assert.equal(BigInt(String(prepared.call.value)), requestedAmount, "native transaction value must match the requested amount")
    }
    if (route === "createChannel") {
      await assert.rejects(() => simulateCamContractCall({ publicClient, account: accounts.relayer.address, call: prepared.call }), "non-admin must fail even with the rendered admin call")
    }
    if (["registerVoucherKey", "fund", "requestWithdrawal", "setWithdrawal", "move"].includes(route)) {
      assert.deepEqual(prepared.call.then.args, inert({ customer: accounts[role].address, channelId: inspected.channelId }), "sender continuation captures the actor and affected channel")
      await session.setAccount({ address: accounts.relayer.address })
      assert.deepEqual(prepared.call.then.args, inert({ customer: accounts[role].address, channelId: inspected.channelId }), "later account changes must not rewrite a prepared continuation")
      await session.setAccount({ address: accounts[role].address })
    }
    await simulateCamContractCall({ publicClient, account: accounts[role].address, call: prepared.call })
    const walletClient = createWalletClient({ account: accounts[role], chain, transport: http(rpcURL) })
    const hash = await sendCamContractCall({ walletClient, chain, call: prepared.call })
    const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: RECEIPT_TIMEOUT })
    assert.equal(receipt.status, "success", `${route} must succeed`)
    assert.equal(prepared.call.then.namespace, "routes")
    await session.navigate(prepared.call.then.function, prepared.call.then.args)
    process.stdout.write(`${JSON.stringify({ event: "write_ok", role, route, hash })}\n`)
    return { receipt, abi: prepared.call.abi }
  }
  async function mature() {
    const deadline = BigInt(String(view().readyAt))
    const current = (await publicClient.getBlock()).timestamp
    if (deadline > current) await localRpc(rpcURL, "evm_increaseTime", [Number(deadline - current)])
    await localRpc(rpcURL, "evm_mine", [])
    await session.refresh()
  }
  async function voucher(total: bigint, previousTotal: bigint) {
    assert.equal(String(view().voucherKey).toLowerCase(), voucherSigner.address.toLowerCase())
    const now = (await publicClient.getBlock()).timestamp
    const merchant = requireEvmAddress(String(view().payee), "fixture invoice merchant")
    const invoice = assertInvoiceAcceptance({
      version: "1", purchaseId: sha256(stringToBytes(`local purchase:${previousTotal}:${total}`)),
      merchant, customer: accounts.customer.address, chainId: "31337", paymentContract: payments,
      channelId: "1", previousTotal: previousTotal.toString(), cumulativeTotal: total.toString(),
      acceptBefore: (now + 3600n).toString(), termsHash: sha256(stringToBytes("local fixture purchase terms")),
    }, { chainId: 31337n, paymentContract: payments, customer: accounts.customer.address, channelId: 1n, merchant, previousTotal, now })
    const typed = voucherForInvoice(invoice)
    const invoiceHash = hashInvoice(invoice)
    const signature = await voucherSigner.signTypedData(typed)
    session.updateState(inert({ cumulativeTotal: total.toString(), invoiceHash }))
    const read = await session.dispatchAction(action("voucherDigest", false))
    assert.equal(read.type, "navigated")
    assert.equal(loaded().values[0], hashTypedData(typed), "CAM digest and standard typed-data hashing must agree")
    assert.equal(loaded().inputs.invoiceHash, invoiceHash)
    await position("customer", "1")
    return { invoice, cumulativeTotal: total.toString(), invoiceHash, signature }
  }
  async function collect(signed: Awaited<ReturnType<typeof voucher>>) {
    const beforePaid = BigInt(String(view().voucherPaid))
    const beforeBalance = BigInt(String(view().balance))
    const total = BigInt(signed.cumulativeTotal)
    const remaining = total > beforePaid ? total - beforePaid : 0n
    const expected = remaining < beforeBalance ? remaining : beforeBalance
    const { receipt, abi } = await write("relayer", "collect", {
      cumulativeTotal: signed.cumulativeTotal, invoiceHash: signed.invoiceHash, signature: signed.signature,
    })
    const logs = receipt.logs.filter(log => log.address.toLowerCase() === payments.toLowerCase())
    assert.equal(logs.length, expected === 0n ? 0 : 1, "zero collection does not emit an invoice receipt")
    if (expected !== 0n) {
      const event = decodeEventLog({ abi, eventName: "VoucherCollected", ...logs[0]! })
      const args = object(event.args)
      assert.equal(String(args.customer).toLowerCase(), accounts.customer.address.toLowerCase())
      assert.equal(args.channelId, 1n)
      assert.equal(String(args.payee).toLowerCase(), String(view().payee).toLowerCase())
      assert.equal(args.amount, expected)
      assert.equal(args.voucherPaid, beforePaid + expected)
      assert.equal(args.invoiceHash, signed.invoiceHash, "event references the submitted voucher, not invoice allocation")
    }
    assert.equal(BigInt(String(view().voucherPaid)), beforePaid + expected)
    return abi
  }

  action("createChannel", false)
  assert.equal(loaded().state.fundAmount, undefined, "entry chooser must not display a balance form")
  await write("admin", "createChannel", { newPayee: accounts.payee.address, newClaimPeriod: "60" })
  await position("customer", "1")
  assert.equal(String(view().payee).toLowerCase(), accounts.payee.address.toLowerCase())
  action("createChannel", true)
  action("setPayee", true)
  action("withdraw", true)
  action("collect", true)
  action("registerVoucherKey", false)
  await write("customer", "registerVoucherKey", { newVoucherKey: voucherSigner.address })
  assert.equal(String(view().voucherKey).toLowerCase(), voucherSigner.address.toLowerCase())
  action("registerVoucherKey", true)
  action("collect", false)
  await write("customer", "fund", { fundAmount: "100" })
  assert.equal(view().effectiveBalance, "100")
  // P2P assigns disjoint cumulative intervals; this fixture is not its durable purchase ledger.
  const firstPurchase = await voucher(60n, 0n)
  const secondPurchase = await voucher(100n, 60n)
  await write("customer", "requestWithdrawal", { withdrawAmount: "80" })
  assert.equal(view().effectiveBalance, "20")
  action("requestWithdrawal", true)

  await collect(firstPurchase)
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
  await collect(secondPurchase)
  assert.equal(await publicClient.getBalance({ address: accounts.admin.address }), recipientBefore + 30n)
  assert.equal(view().voucherPaid, "90")
  await position("customer", "1")
  await write("customer", "fund", { fundAmount: "20" })
  await collect(secondPurchase)
  assert.equal(view().voucherPaid, "100")
  assert.equal(view().balance, "10")
  await collect(firstPurchase)
  assert.equal(view().balance, "10", "older voucher must not repay")
  await position("customer", "1")
  const larger = await voucher(150n, 100n)
  await collect(larger)
  assert.equal(view().voucherPaid, "110")
  await position("customer", "1")
  await write("customer", "fund", { fundAmount: "40" })
  await collect(larger)
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
  const duringWait = await voucher(210n, 150n)
  await collect(duringWait)
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
  const emptyingVoucher = await voucher(230n, 210n)
  await collect(emptyingVoucher)
  assert.equal(view().balance, "0")
  await mature()
  await write("relayer", "withdraw", {})
  assert.equal(view().requestedAmount, "0", "zero-payment mature withdrawal consumes the request")
  assert.equal(view().readyAt, "0")
  assert.equal(view().voucherPaid, "230")
  assert.equal(String(view().voucherKey).toLowerCase(), voucherSigner.address.toLowerCase(), "emptying a position never resets its key")
  action("registerVoucherKey", true)
  assert.equal(await publicClient.getBalance({ address: payments }), 0n)

  // A later invoice's voucher can cover earlier invoices, even after offer acceptance has expired.
  await position("customer", "1")
  await write("customer", "fund", { fundAmount: "50" })
  const invoiceA = await voucher(260n, 230n)
  const invoiceB = await voucher(300n, 260n)
  assert.notEqual(invoiceA.invoiceHash, invoiceB.invoiceHash)
  session.updateState(inert({ cumulativeTotal: invoiceB.cumulativeTotal, invoiceHash: invoiceA.invoiceHash, signature: invoiceB.signature }))
  const substituted = await session.dispatchAction(action("collect", false))
  assert.equal(substituted.type, "contractCall")
  if (substituted.type !== "contractCall") throw new Error("fixture expected a collection")
  await assert.rejects(() => simulateCamContractCall({ publicClient, account: accounts.relayer.address, call: substituted.call }), "changing only the invoice reference must invalidate the signature")
  await localRpc(rpcURL, "evm_increaseTime", [3601])
  await localRpc(rpcURL, "evm_mine", [])
  await session.refresh()
  assert.equal(view().balance, "50")
  const merchantBefore = await publicClient.getBalance({ address: accounts.admin.address })
  await collect(invoiceB)
  assert.equal(view().voucherPaid, "280", "B's collection covers A's 30 and 20 of B's 40")
  await collect(invoiceA)
  await position("customer", "1")
  await write("customer", "fund", { fundAmount: "20" })
  const abi = await collect(invoiceB)
  assert.equal(view().voucherPaid, "300")
  assert.equal(await publicClient.getBalance({ address: accounts.admin.address }), merchantBefore + 70n)
  const merchantPosition = object(await publicClient.readContract({
    address: payments, abi, functionName: "viewPosition", args: [accounts.admin.address, 1n, accounts.admin.address],
  }))
  assert.equal(merchantPosition.balance, 0n, "merchant earnings go to its wallet, not a shared spending position")
  assert.equal(await publicClient.getBalance({ address: payments }), 0n)
  await assert.rejects(() => session.navigate("position", inert({ customer: accounts.customer.address, channelId: "999" })), "undefined channel must fail")
  process.stdout.write(`${JSON.stringify({ event: "ok", host, payments, voucherPaid: "300", contractBalance: "0" })}\n`)
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
  process.stderr.write(`Payment-channel scenario failed: ${viewerErrorMessage(error)}\n`)
  process.exitCode = 1
})
