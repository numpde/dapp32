# Contract-Defined Workflows

This repository explores contract-defined workflows: contracts publish
conformance-checked, hash-pinned CAM bundles that generic viewers, wallets, and
agents can render or interpret without trusting bespoke frontend JavaScript.

The goal is to make dapp workflows portable, inspectable, and closer to the
contracts that authorize them.

Project overview: <https://numpde.github.io/dapp32/>

## Solidity formatting

Normalize one first-level dapp with the repository-pinned Foundry image:

```bash
make format DAPP=escrow
```

Check formatting across every dapp without modifying files:

```bash
make fmt
```
