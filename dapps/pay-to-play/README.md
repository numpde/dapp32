# Pay-to-Play

Native-asset positions with permanent voucher keys, invoice-bound cumulative payments, delayed withdrawals and full-balance recovery. Contracts enforce payment authority; the service owns invoice acceptance, allocation and delivery.

## Guides

- [Use the app](https://numpde.github.io/dapp32/pay-to-play/) and [try a local payment](https://numpde.github.io/dapp32/pay-to-play/local-payment.html).
- [Integrate a service](https://numpde.github.io/dapp32/pay-to-play/integration.html), including signing, outstanding exposure and settlement interpretation.
- [Supply an isolated test deployment](https://numpde.github.io/dapp32/development/payment-fixture.html) to another repository.
- [Run application checks](https://numpde.github.io/dapp32/development/app-checks.html#payment).
- [Deploy or update](https://numpde.github.io/dapp32/deployment/pay-to-play/), with explicit compatibility and ownership checks.

## Source

[Payment contract](src/PayToPlay.sol) · [Read projection](src/PayToPlayUI.sol) · [CAM routes](cam/main.json) · [Screens](cam/ui.json) · [ABI](cam/abi/PayToPlay.json).

The [invoice/voucher helper](../../js/tools/pay-to-play-vouchers/README.md) owns exact encodings, interoperability vectors and signing APIs. The [refund worker](../../js/tools/pay-to-play-refunds/README.md) owns bounded discovery, refund batching and journal handling. These references do not authorize a public contract replacement.
