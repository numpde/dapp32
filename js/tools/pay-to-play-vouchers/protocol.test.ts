import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import test from "node:test"
import { hashTypedData, recoverTypedDataAddress } from "viem"
import type { Address, Hex } from "viem"
import { privateKeyToAccount } from "viem/accounts"
import {
  assertInvoiceAcceptance, canonicalInvoice, hashInvoice, readInvoice,
  voucherForInvoice, voucherTypedData,
} from "./protocol.ts"

const customer = `0x${"11".repeat(20)}` as Address
const merchant = `0x${"22".repeat(20)}` as Address
const paymentContract = `0x${"33".repeat(20)}` as Address
const invoice = {
  version: "1", purchaseId: `0x${"44".repeat(32)}`,
  merchant, customer, chainId: "31337", paymentContract,
  channelId: "7", previousTotal: "30", cumulativeTotal: "70",
  acceptBefore: "2000000000", termsHash: `0x${"55".repeat(32)}`,
}
const expected = {
  customer, merchant, paymentContract, chainId: 31337n, channelId: 7n,
  previousTotal: 30n, now: 1999999999n,
}

test("invoice encoding has a fixed independently calculated SHA-256 vector", () => {
  const canonical = canonicalInvoice(invoice)
  assert.equal(hashInvoice(invoice), "0x0dc9d65564652244fdbd9403130bb271c7800630b3f8f8e0c3d7282ab237f641")
  assert.equal(hashInvoice(invoice), `0x${createHash("sha256").update(canonical, "utf8").digest("hex")}`)
  assert.deepEqual(JSON.parse(canonical), [
    "PayToPlayInvoice/1", invoice.purchaseId, merchant, customer, "31337", paymentContract,
    "7", "30", "70", "2000000000", invoice.termsHash,
  ])
  assert(!canonical.endsWith("\n"))
})

test("object order and hex letter case do not change invoice commitments", () => {
  const source = { ...invoice, purchaseId: `0x${"ab".repeat(32)}`, termsHash: `0x${"cd".repeat(32)}` }
  const reversed = Object.fromEntries(Object.entries(source).reverse())
  assert.equal(hashInvoice(source), hashInvoice(reversed))
  assert.equal(hashInvoice(source), hashInvoice({ ...source, purchaseId: `0x${"AB".repeat(32)}`, termsHash: `0x${"CD".repeat(32)}` }))
  assert(Object.isFrozen(readInvoice(source)))
})

test("all immutable commercial and settlement fields affect the commitment", () => {
  const changed: Record<string, string> = {
    purchaseId: `0x${"66".repeat(32)}`, merchant: `0x${"77".repeat(20)}`,
    customer: `0x${"88".repeat(20)}`, chainId: "31338", paymentContract: `0x${"99".repeat(20)}`,
    channelId: "8", previousTotal: "31", cumulativeTotal: "71", acceptBefore: "2000000001",
    termsHash: `0x${"aa".repeat(32)}`,
  }
  for (const [name, value] of Object.entries(changed)) {
    assert.notEqual(hashInvoice({ ...invoice, [name]: value }), hashInvoice(invoice), name)
  }
})

test("invoice codec rejects ambiguous decimals, malformed references and mutable status", () => {
  for (const value of [30, "030", "-1", "1.5", "1e2", " 30", "30 ", ((1n << 256n)).toString()]) {
    assert.throws(() => readInvoice({ ...invoice, previousTotal: value }))
  }
  for (const changed of [
    { version: "2" }, { channelId: "0" }, { chainId: "0" }, { acceptBefore: "0" },
    { cumulativeTotal: "30" }, { cumulativeTotal: "29" }, { purchaseId: "0x12" },
    { merchant: "not an address" }, { termsHash: "0x" }, { invoiceHash: `0x${"00".repeat(32)}` },
    { status: "refunded" }, { amount: "40" },
  ]) assert.throws(() => readInvoice({ ...invoice, ...changed }))
  const missing = Object.fromEntries(Object.entries(invoice).filter(([name]) => name !== "termsHash"))
  assert.throws(() => readInvoice(missing))
})

test("voucher commits to the owner and reference without confusing signer and customer", async () => {
  // Public voucher-only key used only for offline/local fixture tests.
  const signer = privateKeyToAccount(`0x${"55".repeat(32)}`)
  const typed = voucherForInvoice(invoice)
  assert.equal(typed.domain.name, "PayToPlay")
  assert.equal(typed.domain.version, "2")
  assert.equal(typed.domain.verifyingContract, paymentContract)
  assert.equal(typed.message.customer, customer)
  assert.notEqual(signer.address.toLowerCase(), customer)
  assert.equal(typed.message.channelId, 7n)
  assert.equal(typed.message.cumulativeTotal, 70n)
  assert.equal(typed.message.invoiceHash, hashInvoice(invoice))
  const signature = await signer.signTypedData(typed)
  assert.equal((await recoverTypedDataAddress({ ...typed, signature })).toLowerCase(), signer.address.toLowerCase())
  const altered = { ...typed, message: { ...typed.message, invoiceHash: `0x${"66".repeat(32)}` as Hex } }
  assert.notEqual((await recoverTypedDataAddress({ ...altered, signature })).toLowerCase(), signer.address.toLowerCase())
})

test("acceptance checks caller-owned stream order, not the onchain actually-paid total", () => {
  assert.deepEqual(assertInvoiceAcceptance(invoice, expected), readInvoice(invoice))
  assert.throws(() => assertInvoiceAcceptance(invoice, { ...expected, previousTotal: 0n }), /stream/)
  // After reserving 30 -> 70, a concurrent purchase must not reuse that interval.
  assert.throws(() => assertInvoiceAcceptance(invoice, { ...expected, previousTotal: 70n }), /stream/)
  assert.equal(assertInvoiceAcceptance({ ...invoice, previousTotal: "70", cumulativeTotal: "80" }, {
    ...expected, previousTotal: 70n,
  }).cumulativeTotal, "80")
})

test("acceptance rejects mismatched customer, merchant, deployment, chain and channel", () => {
  for (const pin of [
    { customer: merchant }, { merchant: customer }, { paymentContract: merchant },
    { chainId: 1n }, { channelId: 8n },
  ]) assert.throws(() => assertInvoiceAcceptance(invoice, { ...expected, ...pin }), /position/)
})

test("invoice offer expiry does not prevent reconstructing an already-issued voucher", async () => {
  const signer = privateKeyToAccount(`0x${"55".repeat(32)}`)
  const typed = voucherForInvoice(assertInvoiceAcceptance(invoice, expected))
  const signature = await signer.signTypedData(typed)
  assert.throws(() => assertInvoiceAcceptance(invoice, { ...expected, now: 2000000000n }), /window/)
  assert.throws(() => assertInvoiceAcceptance(invoice, { ...expected, now: 2000000001n }), /window/)
  const recovered = voucherForInvoice(JSON.parse(JSON.stringify(invoice)))
  assert.equal(hashTypedData(recovered), hashTypedData(typed))
  assert.equal((await recoverTypedDataAddress({ ...recovered, signature })).toLowerCase(), signer.address.toLowerCase())
})

test("voucher builder has no legacy domain or invoice-less fallback", () => {
  const typed = voucherForInvoice(invoice)
  assert.notEqual(hashTypedData(typed), hashTypedData({ ...typed, domain: { ...typed.domain, version: "1" } }))
  assert.notEqual(hashTypedData(typed), hashTypedData({ ...typed, domain: { ...typed.domain, verifyingContract: customer } }))
  const input = {
    chainId: 31337n, paymentContract, customer, channelId: 7n,
    cumulativeTotal: 70n, invoiceHash: hashInvoice(invoice),
  }
  for (const changed of [
    { cumulativeTotal: -1n }, { cumulativeTotal: 1n << 256n }, { chainId: 0n },
    { channelId: 0n }, { invoiceHash: "0x" as Hex },
  ]) assert.throws(() => voucherTypedData({ ...input, ...changed }))
  assert.equal(voucherTypedData({ ...input, cumulativeTotal: 0n, invoiceHash: `0x${"00".repeat(32)}` }).message.cumulativeTotal, 0n)
})
