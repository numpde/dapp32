# Escrow

An immutable, single-milestone native-asset escrow. Settlement credits one beneficiary; that account withdraws its aggregated credit in a separate transaction. The client selects the arbitrator, who does not acknowledge participation on chain.

## Guides

- [Use Escrow](https://numpde.github.io/dapp32/escrow/): create, submit, settle and withdraw.
- [Prepare document commitments](https://numpde.github.io/dapp32/escrow/documents.html).
- [Understand identity, accounting and projection](https://numpde.github.io/dapp32/escrow/reference.html).
- [Run scenarios and browser checks](https://numpde.github.io/dapp32/development/app-checks.html#escrow).
- [Deploy the app](https://numpde.github.io/dapp32/deployment/escrow/), including independent CAM ownership.

## Source

[Core contract](src/CamEscrow.sol) · [Read projection](src/CamEscrowUI.sol) · [CAM routes](cam/main.json) · [Screens](cam/ui.json) · [Tests](test/).

The application model `escrow.agreement.v1` is not a generic CAM machine resource. Current protocol rules live in the [versioned reference](https://numpde.github.io/dapp32/reference/cam/1.4.0/); an app-model version does not select an older CAM format.
