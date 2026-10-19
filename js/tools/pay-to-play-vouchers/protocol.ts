import { sha256, stringToBytes, zeroAddress } from "viem"
import type { Address, Hex } from "viem"
import { requireEvmAddress } from "../../packages/cam-evm-viem/dist/index.js"
import { requiredRecord, requiredString } from "../input.ts"

const MAX_UINT256 = (1n << 256n) - 1n
const INVOICE_FIELDS = [
  "version", "purchaseId", "merchant", "customer", "chainId", "paymentContract",
  "channelId", "previousTotal", "cumulativeTotal", "acceptBefore", "termsHash",
] as const

export const VOUCHER_TYPES = {
  Voucher: [
    { name: "customer", type: "address" },
    { name: "channelId", type: "uint256" },
    { name: "cumulativeTotal", type: "uint256" },
    { name: "invoiceHash", type: "bytes32" },
  ],
} as const

/** Immutable commercial reference. Decimal amounts are native base units; amount = total - previousTotal. */
export type Invoice = Readonly<{
  version: "1"
  purchaseId: Hex
  merchant: Address
  customer: Address
  chainId: string
  paymentContract: Address
  channelId: string
  previousTotal: string
  cumulativeTotal: string
  acceptBefore: string
  termsHash: Hex
}>

export type VoucherInput = Readonly<{
  chainId: bigint
  paymentContract: Address
  customer: Address
  channelId: bigint
  cumulativeTotal: bigint
  invoiceHash: Hex
}>

/** Resolve a strict invoice document, not mutable purchase/fulfillment/refund state. */
export function readInvoice(value: unknown): Invoice {
  const source = requiredRecord(value, "invoice")
  const keys = Object.keys(source).sort()
  if (keys.join("\n") !== [...INVOICE_FIELDS].sort().join("\n")) {
    throw new Error("invoice must contain exactly the version-1 invoice fields")
  }
  if (source.version !== "1") throw new Error("unsupported invoice version")
  const invoice = {
    version: "1" as const,
    purchaseId: invoiceWord(source.purchaseId, "purchaseId"),
    merchant: invoiceAddress(requiredString(source, "merchant", "invoice.merchant"), "merchant"),
    customer: invoiceAddress(requiredString(source, "customer", "invoice.customer"), "customer"),
    chainId: invoiceDecimal(source, "chainId"),
    paymentContract: invoiceAddress(requiredString(source, "paymentContract", "invoice.paymentContract"), "paymentContract"),
    channelId: invoiceDecimal(source, "channelId"),
    previousTotal: invoiceDecimal(source, "previousTotal"),
    cumulativeTotal: invoiceDecimal(source, "cumulativeTotal"),
    acceptBefore: invoiceDecimal(source, "acceptBefore"),
    termsHash: invoiceWord(source.termsHash, "termsHash"),
  }
  if (invoice.chainId === "0" || invoice.channelId === "0" || invoice.acceptBefore === "0") {
    throw new Error("invoice chain, payment channel and acceptance deadline must be positive")
  }
  if (BigInt(invoice.cumulativeTotal) <= BigInt(invoice.previousTotal)) {
    throw new Error("invoice must assign a positive cumulative authorization increase")
  }
  return Object.freeze(invoice)
}

/** UTF-8 of this ordered JSON array, without whitespace or a trailing newline. All entries are strings. */
export function canonicalInvoice(value: unknown): string {
  const i = readInvoice(value)
  return JSON.stringify([
    "PayToPlayInvoice/1", i.purchaseId, i.merchant, i.customer, i.chainId, i.paymentContract,
    i.channelId, i.previousTotal, i.cumulativeTotal, i.acceptBefore, i.termsHash,
  ])
}

/** SHA-256 is the service invoice codec; the settlement contract treats every bytes32 as opaque. */
export function hashInvoice(value: unknown): Hex {
  return sha256(stringToBytes(canonicalInvoice(value)))
}

/** No invoice-expiry or current wallet-code check: an issued voucher's authority must remain recoverable. */
export function voucherTypedData(input: VoucherInput) {
  const chainId = unsigned(input.chainId, "chainId")
  const channelId = unsigned(input.channelId, "channelId")
  if (chainId === 0n || channelId === 0n) throw new Error("voucher chain and payment channel must be positive")
  return {
    domain: {
      name: "PayToPlay", version: "2", chainId,
      verifyingContract: invoiceAddress(input.paymentContract, "paymentContract"),
    },
    types: VOUCHER_TYPES,
    primaryType: "Voucher" as const,
    message: {
      customer: invoiceAddress(input.customer, "customer"), channelId,
      cumulativeTotal: unsigned(input.cumulativeTotal, "cumulativeTotal"),
      invoiceHash: invoiceWord(input.invoiceHash, "invoiceHash"),
    },
  }
}

export function voucherForInvoice(value: unknown) {
  const invoice = readInvoice(value)
  return voucherTypedData({
    chainId: BigInt(invoice.chainId), paymentContract: invoice.paymentContract,
    customer: invoice.customer, channelId: BigInt(invoice.channelId),
    cumulativeTotal: BigInt(invoice.cumulativeTotal), invoiceHash: hashInvoice(invoice),
  })
}

/** Check only a NEW acceptance against caller-owned, transactionally reserved stream/context facts. */
export function assertInvoiceAcceptance(value: unknown, expected: Readonly<{
  chainId: bigint
  paymentContract: Address
  customer: Address
  channelId: bigint
  merchant: Address
  previousTotal: bigint
  now: bigint
}>): Invoice {
  const invoice = readInvoice(value)
  if (BigInt(invoice.chainId) !== unsigned(expected.chainId, "chainId")
    || BigInt(invoice.channelId) !== unsigned(expected.channelId, "channelId")
    || invoice.paymentContract !== invoiceAddress(expected.paymentContract, "paymentContract")
    || invoice.customer !== invoiceAddress(expected.customer, "customer")
    || invoice.merchant !== invoiceAddress(expected.merchant, "merchant")) {
    throw new Error("invoice does not match the selected customer, merchant and settlement position")
  }
  if (BigInt(invoice.previousTotal) !== unsigned(expected.previousTotal, "previousTotal")) {
    throw new Error("invoice does not continue the reserved authorization stream")
  }
  if (unsigned(expected.now, "now") >= BigInt(invoice.acceptBefore)) {
    throw new Error("invoice acceptance window has ended")
  }
  return invoice
}

function invoiceAddress(value: string, label: string): Address {
  const address = requireEvmAddress(value, label).toLowerCase() as Address
  if (address === zeroAddress) throw new Error(`${label} must be nonzero`)
  return address
}

function invoiceWord(value: unknown, label: string): Hex {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw new Error(`${label} must be exactly 32 hex-encoded bytes`)
  }
  return value.toLowerCase() as Hex
}

function invoiceDecimal(source: Record<string, unknown>, name: string): string {
  const value = requiredString(source, name, `invoice.${name}`)
  if (!/^(0|[1-9][0-9]{0,77})$/.test(value)) throw new Error(`invoice.${name} must be canonical decimal uint256 text`)
  unsigned(BigInt(value), `invoice.${name}`)
  return value
}

function unsigned(value: bigint, label: string): bigint {
  if (typeof value !== "bigint" || value < 0n || value > MAX_UINT256) throw new Error(`${label} must be uint256`)
  return value
}
