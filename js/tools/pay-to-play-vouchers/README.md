# PayToPlay invoice references and voucher data

`protocol.ts` owns the repository's invoice-reference encoding and PayToPlay v2
EIP-712 data construction. The RPC and browser scenarios use these functions.
They add no network requests, wallet storage, invoice database or purchase
service. The settlement contract treats `invoiceHash` as an opaque `bytes32`;
this codec is a service/client convention, not an onchain invoice parser.

## Two independent versions

- **Invoice encoding:** `PayToPlayInvoice/1`, represented by document field
  `version: "1"`.
- **Voucher domain:** EIP-712 name `PayToPlay`, version `2`, the deployment chain
  ID and the payment contract address. The CAM host is not the payment contract.

Invoice encoding version 1 is not the old invoice-less payment protocol. The
new contract accepts only the four-field v2 voucher; there is no v1 fallback.

## Immutable invoice document

The document contains exactly these fields, all strings. Unknown or missing
fields are rejected. JSON object property order is irrelevant.

| Field | Meaning |
| --- | --- |
| `version` | Exactly `"1"`. |
| `purchaseId` | A 32-byte purchase identifier, persisted by the service across retries. |
| `merchant` | Nonzero merchant address checked against the selected commercial counterparty. |
| `customer` | Nonzero balance-owner address, not necessarily the voucher-signing key. |
| `chainId` | Positive chain ID as canonical decimal text. |
| `paymentContract` | Nonzero PayToPlay settlement address. |
| `channelId` | Positive payment-channel ID as canonical decimal text; channel 0 cannot collect. |
| `previousTotal` | Start of this purchase's reserved cumulative authorization interval. |
| `cumulativeTotal` | End of that interval; must exceed `previousTotal`. |
| `acceptBefore` | Positive Unix-second deadline for NEW commercial acceptance. |
| `termsHash` | 32-byte commitment to the immutable purchase terms. Their encoding is agreed by the service and client. |

Amounts are native-currency base units. Purchase price is derived exactly as
`cumulativeTotal - previousTotal`; a redundant mutable amount field is not
accepted. Integer strings must be canonical unsigned decimal uint256 values:
no leading zeros except `"0"`, whitespace, signs, fractions or exponent notation.
All addresses and 32-byte hex fields are normalized to lowercase.

Keep mutable purchase state (accepted, fulfilled, cancelled, refunded,
collection allocation) outside this document. Retain the exact normalized
invoice, its referenced terms, and the signed voucher for later reconciliation.
The hash does not authenticate the merchant's identity by itself: the service
must authenticate the invoice issuer and the client must verify the selected
merchant and settlement context before authorizing payment.

## Exact hash preimage

`canonicalInvoice(document)` produces the UTF-8 bytes of this ordered JSON array:

```text
[
  "PayToPlayInvoice/1",
  purchaseId,
  merchant,
  customer,
  chainId,
  paymentContract,
  channelId,
  previousTotal,
  cumulativeTotal,
  acceptBefore,
  termsHash
]
```

The displayed layout is explanatory. Actual serialization is `JSON.stringify`
on the normalized array: **no indentation, spaces or trailing newline**, and
all elements are JSON strings. Fixed-width hex and canonical decimal fields
avoid arbitrary JSON-number and object-order ambiguity. Hash these bytes with
**SHA-256** to obtain `invoiceHash`.

Do not hash the original JSON file bytes, pretty-printed JSON, an invoice URL,
or an arbitrary object serialization. Those are different preimages.

### Fixed interoperability vector

```json
{
  "version": "1",
  "purchaseId": "0x4444444444444444444444444444444444444444444444444444444444444444",
  "merchant": "0x2222222222222222222222222222222222222222",
  "customer": "0x1111111111111111111111111111111111111111",
  "chainId": "31337",
  "paymentContract": "0x3333333333333333333333333333333333333333",
  "channelId": "7",
  "previousTotal": "30",
  "cumulativeTotal": "70",
  "acceptBefore": "2000000000",
  "termsHash": "0x5555555555555555555555555555555555555555555555555555555555555555"
}
```

Expected hash:

```text
0x0dc9d65564652244fdbd9403130bb271c7800630b3f8f8e0c3d7282ab237f641
```

The test computes the same digest independently with Node's SHA-256 function.
These are public test values, not a live invoice or deployment.

### Peer exact-byte vector

`tests/fixtures/pay-to-play/p2p_invoice_codec_v1.json` is an independent,
synthetic peer envelope pinned from `pay-to-play` commit `73d2698` with artifact
SHA-256
`40adc7a3433a95bdfc5f681355df679391028a9b172847c0768f3bb4f3c3191e`. Its
`invoiceHash` is SHA-256 of `invoicePrefixUtf8` followed by the exact
`invoiceUtf8` bytes. The shared-vector test checks those original bytes and
base64 representation, EIP-712 domain and voucher digests, fixture-key address
and signature recovery, plus the confirmation interval bindings.

That peer envelope is a distinct exact-document-byte codec. It is deliberately
not accepted by this helper's `readInvoice`, and its invoice hash must not be
replaced with `hashInvoice` or `voucherForInvoice`: this helper hashes its own
normalized field-array encoding. The vector tests also show that whitespace-only
changes preserve decoded JSON while changing the peer exact-byte hash and the
corresponding signed voucher digest. These fixture checks establish local
codec/signature interoperability only; they do not assert invoice issuer
authority, service acceptance, durable reservations, fulfillment, or a valid
commercial submission.

## Signing and acceptance

The helpers deliberately separate offer acceptance from voucher reconstruction:

```ts
const invoice = assertInvoiceAcceptance(document, {
  chainId,
  paymentContract,
  customer,
  channelId,
  merchant,
  previousTotal: reservedPreviousAuthorizationTotal,
  now: acceptanceTimestamp,
})
const typed = voucherForInvoice(invoice)
const signature = await registeredVoucherSigner.signTypedData(typed)
```

`assertInvoiceAcceptance` verifies document structure, the caller's selected
settlement context, the reserved authorization start and `now < acceptBefore`.
It does **not** reserve the interval, implement concurrency control, verify
backing, check the onchain recovery phase, authenticate the merchant, or deliver
the purchase. The service owns those operations and its confirmation policy.

The service must durably serialize/reserve one authorization sequence per
`(chain, paymentContract, customer, channelId)`. Use the prior authorized total,
not the latest onchain `voucherPaid`, when reserving the next interval. Two
concurrent purchases from total 100 must not both authorize total 110 and then
be counted as 20 of revenue. Retry the same purchase and recorded authorization;
do not create a second increase because a response was lost.

Before the signing key releases a signature, preserve the corresponding invoice
and authorization as potential payment exposure. Before irreversible delivery,
the service must verify the signature against the position's confirmed permanent
key and apply its backing, earlier-withdrawal and recovery-cutoff policy. The
helper performs none of that durable service orchestration.

`voucherForInvoice` and `voucherTypedData` do not check the clock. An invoice's
offer expiry must not prevent reconstructing or collecting an authorization
that was already issued. Expiry, commercial cancellation, failed delivery, and
a service refund do not invalidate the signature or reduce its cumulative total.
Never rewind `voucherPaid` or reuse an authorization interval on that basis.
Track the highest known signed authorization independently of current commercial
invoice status and of the highest accepted invoice.

The voucher contains only:

```text
Voucher(address customer,uint256 channelId,uint256 cumulativeTotal,bytes32 invoiceHash)
```

The registered key signs; `customer` remains the deposit owner. Verify the digest
against `voucherDigest(customer, channelId, cumulativeTotal, invoiceHash)` on
the correct deployment. Do not use a personal-message signature. Arbitrary
current ERC-1271 wallet approval is not a substitute for the permanent key.

`voucherTypedData` can also construct a voucher for an externally agreed
32-byte reference. The contract does not require this invoice codec or reject a
zero reference. Such an opaque reference is not evidence of a valid invoice;
the service/client must apply their own invoice validation before signing.

## Collection and interpretation

Submit the exact signed fields to:

```text
collect(customer, channelId, cumulativeTotal, invoiceHash, maxAmount, signature)
```

Only the channel’s configured nonzero collector can submit this call. The admin
sets it at channel creation and can rotate it or set it to zero to pause that
channel. `maxAmount` is an unsigned per-call limit; it is not part of the voucher
and does not prevent repeated partial collection. Withdrawal and refund rights
are independent of the collector.

Payment is `min(maxAmount, max(cumulativeTotal - voucherPaid, 0), balance)` before
the applicable recovery cutoff. `VoucherCollected` reports the actual payment,
the resulting lifetime paid total, and the submitted voucher's invoice hash.
There is no event for a valid zero payment.

Suppose invoice A reserves 0 -> 30 and B reserves 30 -> 70. With balance 50 and
nothing collected, submitting B's voucher pays 50 and emits B's hash. A service
allocating in authorization order assigns 30 to A and 20 to B. The event is not
an assertion that B alone received 50 or that B is fully paid. Later funding of
20 lets the same B voucher pay the remaining 20. Different hashes at total 70
never increase the aggregate authorization beyond 70.

The service owns that allocation and must retain earlier invoices: B's hash
does not commit to A's document merely because B's total includes A's interval.
Reconcile confirmed events by chain, contract, transaction and log identity,
including the service's reorganization policy; invoice hash alone is not a
unique payment ID. A receipt with status success may have collected zero.

A full collateral refund does not clear the key or paid counter. Old unpaid
vouchers can collect after the same position is funded again in an open channel.
Permanent channel retirement prohibits future collection and funding instead.
Commercial refunds are separate transfers/service records, not calls that reset
this settlement accounting.

## Direct merchant settlement

Use a merchant-specific channel whose current payee receives collections.
Receipts enter the merchant's external wallet, not an automatically spendable
position in PayToPlay. Spending those receipts through another channel needs a
separate deposit. No shared spending balance or offchain inter-merchant routing
is implemented here.

Payee administration is unchanged: the admin can redirect collections before
permanent closure, including outstanding vouchers. A merchant address in the
invoice is a client/service context check, not an onchain immutable payee bind.
Changing that trust policy requires a separate protocol decision.

## Validation and deployment

The invoice helper tests run under `make js/tests` through the existing
scenario-tool typecheck/test script. The existing payment RPC scenario now
checks canonical invoice hashing, EIP-712 digest equality, reference tampering,
actual event fields, partial cumulative payment across invoices, offer expiry
and direct wallet receipts. The recovery scenario checks unpaid authorization
across a full refund and refill. The existing bounded browser walkthrough
checks hash entry, signing-detail display, Back/draft preservation, collection
receipts and the recovery flow.

This change requires a new PayToPlay deployment, matching ABI/CAM resources,
v2 signing clients and updated event consumers. Old selectors, old voucher
fields and domain version 1 are not accepted by the new contract. Existing
deployments and their liabilities are not migrated by publishing new resources.
Update deployment/code-hash pins deliberately, including refund-worker pins.
