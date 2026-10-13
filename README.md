# Contract-Defined Workflows

This repository explores contract-defined workflows. A contract publishes a
Contract Application Manifest (CAM) URI and hash, and binds the contract
addresses used by its routes. Generic viewers and agents can load the bundle,
verify its bytes, and render or interpret the workflow. The called contracts
enforce business rules; a manifest or viewer cannot grant transaction authority.

The goal is to make dapp workflows portable, inspectable, and closer to the
contracts that authorize them.

Project overview: <https://numpde.github.io/dapp32/>

## Start here

- [Escrow](dapps/escrow/README.md): create and fund an agreement, review work,
  resolve disputes, and withdraw settlement credit. Includes a local browser
  demo and an automated nine-path workflow.
- [Bike NFT](dapps/bike-nft/README.md): register bicycle components and manage
  ownership, metadata, reports, and delegation. Includes local demos and release
  authority handoffs.
- [Release ceremony](docs/release-ceremony.md): shared deployment mechanics,
  credential files, evidence, and read-only verification.

Docker with Compose and Make are the supported development entrypoints. Run
`make help` for available lanes. Before building, testing, or running a local
demo, materialize the locked dependencies:

```bash
make deps
make package-deps
```

These are the explicit networked dependency steps. To check the installed
workspace and checked-in CAM bundles offline, run:

```bash
make checks
make package-test
make cam-conformance-check
```

Conformance checks find publication defects in supplied bundles; they do not
prove live contract state, wallet authority, or that a transaction will succeed.

## Solidity formatting

Normalize one first-level dapp with the repository-pinned Foundry image:

```bash
make format DAPP=escrow
```

Check formatting across every dapp without modifying files:

```bash
make fmt
```
