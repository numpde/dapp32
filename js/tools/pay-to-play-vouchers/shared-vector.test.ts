import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import test from "node:test"
import { hashTypedData, recoverTypedDataAddress } from "viem"
import type { Address, Hex } from "viem"
import { privateKeyToAccount } from "viem/accounts"
import { readInvoice, voucherTypedData } from "./protocol.ts"

type SharedVector = {
  invoicePrefixUtf8: string
  voucherSignerAddress: Address
  voucherDomain: { name: string; version: string; chainId: string; verifyingContract: Address }
  voucherType: string
  cases: Array<{
    name: string
    invoiceUtf8: string
    invoiceBase64: string
    invoiceHash: Hex
    voucher: {
      chainId: string
      paymentContract: Address
      customer: Address
      channelId: string
      cumulativeTotal: string
      invoiceHash: Hex
    }
    confirmationBinding: {
      voucherDigest: Hex
      invoiceHash: Hex
      chainId: string
      paymentContract: Address
      channelId: string
      customer: Address
      intervalStart: string
      intervalEnd: string
      amount: string
    }
  }>
  exactByteControl: {
    sourceCase: string
    invoiceUtf8: string
    invoiceBase64: string
    invoiceHash: Hex
    expectedDecodedJsonEqual: boolean
    expectedInvoiceHashEqual: boolean
  }
}

const fixtureBytes = await readFile(
  new URL("../../../tests/fixtures/pay-to-play/p2p_invoice_codec_v1.json", import.meta.url),
)
const fixture = JSON.parse(fixtureBytes.toString("utf8")) as SharedVector
const fixtureSigner = privateKeyToAccount(`0x${"55".repeat(32)}`)

function exactInvoiceHash(invoiceUtf8: string): Hex {
  return `0x${createHash("sha256")
    .update(Buffer.from(fixture.invoicePrefixUtf8, "utf8"))
    .update(Buffer.from(invoiceUtf8, "utf8"))
    .digest("hex")}`
}

test("peer invoice fixture preserves exact document bytes", () => {
  assert.equal(
    createHash("sha256").update(fixtureBytes).digest("hex"),
    "40adc7a3433a95bdfc5f681355df679391028a9b172847c0768f3bb4f3c3191e",
  )
  assert.equal(fixture.cases.length, 2)

  for (const vector of fixture.cases) {
    const invoiceBytes = Buffer.from(vector.invoiceUtf8, "utf8")
    assert.deepEqual(Buffer.from(vector.invoiceBase64, "base64"), invoiceBytes, `${vector.name} base64`)
    assert.equal(exactInvoiceHash(vector.invoiceUtf8), vector.invoiceHash, `${vector.name} invoice hash`)
    // This peer's exact-document envelope is not the helper's canonical field-array invoice schema.
    assert.throws(() => readInvoice(JSON.parse(vector.invoiceUtf8)), /exactly the version-1 invoice fields/)
  }

  const source = fixture.cases.find(({ name }) => name === fixture.exactByteControl.sourceCase)
  assert(source)
  const controlBytes = Buffer.from(fixture.exactByteControl.invoiceUtf8, "utf8")
  assert.deepEqual(Buffer.from(fixture.exactByteControl.invoiceBase64, "base64"), controlBytes)
  assert.deepEqual(JSON.parse(controlBytes.toString("utf8")), JSON.parse(source.invoiceUtf8))
  assert.equal(exactInvoiceHash(fixture.exactByteControl.invoiceUtf8), fixture.exactByteControl.invoiceHash)
  assert.notEqual(fixture.exactByteControl.invoiceHash, source.invoiceHash)
  assert.equal(fixture.exactByteControl.expectedDecodedJsonEqual, true)
  assert.equal(fixture.exactByteControl.expectedInvoiceHashEqual, false)
})

test("peer vouchers match v2 digest and confirmation bindings", async () => {
  assert.equal(fixture.voucherType, "Voucher(address customer,uint256 channelId,uint256 cumulativeTotal,bytes32 invoiceHash)")
  assert.equal(fixtureSigner.address.toLowerCase(), fixture.voucherSignerAddress.toLowerCase())
  let expectedIntervalStart = 0n

  for (const vector of fixture.cases) {
    const voucher = vector.voucher
    const typed = voucherTypedData({
      chainId: BigInt(voucher.chainId),
      paymentContract: voucher.paymentContract,
      customer: voucher.customer,
      channelId: BigInt(voucher.channelId),
      cumulativeTotal: BigInt(voucher.cumulativeTotal),
      invoiceHash: voucher.invoiceHash,
    })
    assert.deepEqual(typed.domain, {
      name: fixture.voucherDomain.name,
      version: fixture.voucherDomain.version,
      chainId: BigInt(fixture.voucherDomain.chainId),
      verifyingContract: fixture.voucherDomain.verifyingContract.toLowerCase(),
    })

    const binding = vector.confirmationBinding
    const digest = hashTypedData(typed)
    assert.equal(digest, binding.voucherDigest, `${vector.name} voucher digest`)
    assert.equal(binding.invoiceHash, vector.invoiceHash, `${vector.name} confirmation invoice hash`)
    assert.equal(binding.invoiceHash, voucher.invoiceHash, `${vector.name} voucher invoice hash`)
    assert.equal(binding.chainId, voucher.chainId)
    assert.equal(binding.paymentContract.toLowerCase(), voucher.paymentContract.toLowerCase())
    assert.equal(binding.customer.toLowerCase(), voucher.customer.toLowerCase())
    assert.equal(binding.channelId, voucher.channelId)

    const invoice = JSON.parse(vector.invoiceUtf8) as { amount: string }
    const intervalStart = BigInt(binding.intervalStart)
    const intervalEnd = BigInt(binding.intervalEnd)
    assert.equal(intervalStart, expectedIntervalStart, `${vector.name} interval start`)
    assert.equal(intervalEnd, BigInt(voucher.cumulativeTotal), `${vector.name} interval end`)
    assert.equal(intervalEnd - intervalStart, BigInt(invoice.amount), `${vector.name} invoice amount`)
    assert.equal(binding.amount, invoice.amount, `${vector.name} confirmation amount`)
    expectedIntervalStart = intervalEnd

    const signature = await fixtureSigner.signTypedData(typed)
    assert.equal(
      (await recoverTypedDataAddress({ ...typed, signature })).toLowerCase(),
      fixtureSigner.address.toLowerCase(),
      `${vector.name} fixture signature recovery`,
    )
    if (vector.name === fixture.exactByteControl.sourceCase) {
      const changed = {
        ...typed,
        message: { ...typed.message, invoiceHash: fixture.exactByteControl.invoiceHash },
      }
      assert.notEqual(hashTypedData(changed), digest)
      assert.notEqual(
        (await recoverTypedDataAddress({ ...changed, signature })).toLowerCase(),
        fixtureSigner.address.toLowerCase(),
        "whitespace-only source change must invalidate the signed invoice reference",
      )
    }
  }
})
