# PayToPlay invoice-bearing vouchers (v2)

Later design decision (2026-10-20): [restart pending withdrawal waits on funding](022_pay_to_play_withdrawal_wait_on_funding.txt)
supersedes the ordinary-withdrawal baseline retained by this invoice-v2 change.
The original design below is preserved; the later rule is not yet implemented.

This change extends the existing cumulative-voucher protocol. It does not add an invoice ledger or a general shared-balance payment network. P2P/service code remains responsible for invoice issuance, durable purchase acceptance, authorization sequencing, allocation, fulfillment and commercial refunds.

## Wire format

The EIP-712 domain is `PayToPlay`, version `2`, with the deployment chain ID and the PayToPlay payment contract address. The CAM host address is not the payment contract.

```text
Voucher(address customer,uint256 channelId,uint256 cumulativeTotal,bytes32 invoiceHash)

voucherDigest(customer, channelId, cumulativeTotal, invoiceHash)
collect(customer, channelId, cumulativeTotal, invoiceHash, signature)
```

`VoucherCollected` contains customer, channelId, payee, actual amount, resulting lifetime voucherPaid and invoiceHash. Customer, channelId and payee remain indexed; invoiceHash is not indexed. Old function selectors, three-field vouchers and domain version 1 are not supported by this deployment.

The registered permanent voucher key signs the message. The customer field remains the deposit owner, even when its address differs from the signing key. Changing the invoice hash without obtaining a new signature invalidates the voucher, including when collection would otherwise pay zero.

## Payment semantics

The contract still pays:

```text
min(max(cumulativeTotal - voucherPaid, 0), position.balance)
```

The reference is opaque onchain. There is no per-invoice storage, uniqueness constraint, allocation, consumption flag, expiry check or fulfillment check. Zero hashes are accepted as opaque values; clients/services must not mistake that for evidence of a valid invoice.

One collection may cover several invoices, partially or fully. If invoice A reserves 0 -> 30 and invoice B reserves 30 -> 70, submitting B's voucher against balance 50 with voucherPaid 0 transfers 50 and emits B's hash. Allocation in authorization order would assign 30 to A and 20 to B; the event does not assert that B alone was paid 50. Refilling by 20 lets the same B voucher collect the remaining 20. Distinct hashes at total 70 do not authorize 140.

A valid zero collection emits no collection event. A successful transaction receipt alone is not proof that an invoice was paid. Consumers must reconcile actual events and retained service records under their chain-confirmation and reorganization policy.

## Client/service convention

The exact deterministic invoice codec, immutable document fields and interoperability vector are documented in [the invoice/voucher helper guide](../js/tools/pay-to-play-vouchers/README.md). The repository's RPC and browser scenarios use its shared helpers.

The service must maintain one durable authorization sequence per chain, payment contract, customer and channel. Reserve disjoint increases using the previously authorized total, not the latest actually-paid total. A retry recovers the original purchase/invoice/voucher rather than allocating a new increase. Persist potential signed exposure before releasing a signature or delivering work; rejected or expired invoices cannot make a signature that has already escaped disappear.

The helper's acceptance checks are not a persistent P2P service. They do not perform database locking, authenticate invoice issuers, verify backing or recovery phase, enforce a confirmation policy, or fulfill purchases. Integrating services must implement those responsibilities explicitly.

Invoice offer expiry applies to new acceptance, not to a previously issued payment authorization. Commercial cancellation, delivery failure and commercial refunds do not reduce voucherPaid, rewind the authorization sequence or revoke signatures. Retain the highest known signed authority separately from mutable invoice status and commercial amounts due.

## Lifecycle and recipient authority

Annual recovery, final collection cutoffs, early position wind-down, permanent channel retirement, refund destinations and ordinary withdrawals remain unchanged. A full refund clears the funding cycle and withdrawal request, not the voucher key or lifetime paid counter. Old unpaid invoice-bearing vouchers can collect from a later funding cycle in an open channel. A permanently retired channel never accepts new funding or resumes collection.

Payee administration is unchanged. An invoice identifying a merchant does not prevent the admin from changing that channel's current payee. This remains an explicit trust assumption, not an onchain merchant-address binding.

Direct merchant settlement uses a merchant-specific channel. Collections reach the merchant's external wallet. Spending these receipts through another channel requires a separate deposit; there is no automatic shared spending balance.

## Operator and deployment changes

Deploy a new PayToPlay contract. Do not point the v2 ABI/CAM at a v1 deployment. Publish matching ABI, UI and manifest bytes, update the binding, and deliberately update signing clients, event consumers and deployment/runtime-code pins, including refund-worker pins. Old deployments retain their own balances and outstanding authorizations; publication changes do not migrate or cancel them.

The existing offline fixture command now requires the exact invoice hash:

```sh
make pay-to-play/local/voucher/sign \
  PAY_TO_PLAY_ADDRESS=0x... \
  PAY_TO_PLAY_CHANNEL_ID=1 \
  PAY_TO_PLAY_TOTAL=100 \
  PAY_TO_PLAY_INVOICE_HASH=0x...
```

The reference must be exactly 32 bytes (0x followed by 64 hexadecimal digits). The command signs only with the public local fixture customer's key on chain 31337. It does not register a key, validate an invoice document, or send a transaction. Use the same hash and cumulative total when viewing the digest or submitting collection. Never publish real signatures or signing credentials in logs.

The generic CAM form accepts an invoice hash and displays it in signing details; it does not fetch or approve invoice contents. The actual signing client must verify and display the immutable invoice, merchant, settlement context and cumulative increase before asking for authorization.

## Local validation

Use the repository's locked dependency installation and Docker-backed entrypoints. Compiler-exported ABI equality and the executable test suites must be validated before merging or publishing:

```sh
make cam/abi/export
git diff -- dapps/pay-to-play/cam
make tests/checks
make dapps/format/check
make dapps/tests
make js/tests
make cam/conformance/check
make pay-to-play/refunds/check
make pay-to-play/local/recovery/run
```

The recovery target runs the payment scenario first. That scenario compares canonical-invoice v2 signing with the contract digest, checks tampered references and actual collection events, exercises a later invoice paying across earlier invoices, and checks merchant-wallet receipts. The recovery scenario checks outstanding invoice-voucher authority through refund/refill and retains the file-backed refund-worker tests.

The explicit browser check still requires an already-running disposable local GUI and browser CDP endpoint:

```sh
make pay-to-play/live/browser/check \
  CDP_ORIGIN=http://127.0.0.1:9222 \
  VIEWER_URL='<printed local viewer URL>' \
  EXPECTED_CAM_URI=http://127.0.0.1:5175/cam/main.json \
  EXPECTED_CAM_HASH=0x...
```

It verifies invoice-hash entry, signing-detail digest/hash display, Back/draft preservation, collection event fields and the existing recovery walkthrough. It retains the bounded 11-transaction fixture grant and does not start a browser or choose a live deployment.
