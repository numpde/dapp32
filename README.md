# Contract-Defined Workflows

A Contract Application Manifest (CAM) and its resources describe an EVM application's screens, contract calls and follow-up steps. A host contract publishes the manifest's location and hash so a reusable browser viewer or headless client can interpret the workflow. Business contracts—not the manifest or viewer—enforce permissions and state changes.

This repository contains the protocol, TypeScript libraries, browser viewer and example apps. The current experimental format is [CAM 1.4.0 with UI 1.1.0](https://numpde.github.io/dapp32/reference/cam/1.4.0/).

## Documentation

- [Understand what runs where](https://numpde.github.io/dapp32/start/) or [try locally with a test wallet](https://numpde.github.io/dapp32/start/local-wallet.html).
- [Open an existing app](https://numpde.github.io/dapp32/use/) or [host the viewer](https://numpde.github.io/dapp32/viewer/).
- [Author a workflow](https://numpde.github.io/dapp32/authoring/) or [integrate without a browser](https://numpde.github.io/dapp32/authoring/headless.html).
- [Deploy, update or recover an app](https://numpde.github.io/dapp32/deployment/).
- [Set up development and run checks](https://numpde.github.io/dapp32/development/).

## Example app guides

- [Pay-to-Play](https://numpde.github.io/dapp32/pay-to-play/): cumulative voucher payments ([source](dapps/pay-to-play/)).
- [Escrow](https://numpde.github.io/dapp32/escrow/): funded agreements, disputes and withdrawals ([source](dapps/escrow/)).
- [Bike NFT](https://numpde.github.io/dapp32/bike-nft/): component records, ownership and workshop permissions ([source](dapps/bike-nft/)).
