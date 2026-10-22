# Contract-Defined Workflows

This repository explores contract-defined workflows. A contract publishes a
Contract Application Manifest (CAM) URI and hash, and binds the contract
addresses used by its routes. Generic viewers and agents can load the bundle,
verify its bytes, and render or interpret the workflow. The called contracts
enforce business rules; a manifest or viewer cannot grant transaction authority.

The goal is to make dapp workflows portable, inspectable, and closer to the
contracts that authorize them.

Project overview: <https://numpde.github.io/dapp32/>

Current software supports CAM 1.2.0 with UI 1.0.0: [protocol reference](docs/reference/cam/1.2.0/index.html). The [CAM 1.1.0 reference](docs/reference/cam/1.1.0/index.html) is retained as historical documentation only, including its CAM 1.0.0 compatibility description.

## Start here

- [Pay-to-Play](dapps/pay-to-play/README.md): deposit native coins, register a
  permanent voucher key, and authorize cumulative payments. Explains delayed
  withdrawals, full refunds, channel retirement, service integration and the local demo.
- [Escrow](dapps/escrow/README.md): create and fund an agreement, review work,
  resolve disputes, and withdraw settlement credit. Includes a local browser
  demo and an automated nine-path workflow.
- [Bike NFT](dapps/bike-nft/README.md): register bicycle components and manage
  ownership, metadata, reports, and delegation. Includes local demos and release
  authority handoffs.
- [Release ceremony](docs/release-ceremony.md): shared deployment mechanics,
  credential files, evidence, and read-only verification.
- [EVM networks and testnets](docs/evm-networks.html): browse the RPC catalog by
  stable network index, with mainnet/testnet views and authoritative references.
- [Select an RPC service](docs/rpc-services.md): use the executable chain/service
  catalog with deployment commands, or supply your own endpoint. The separate
  `rpc/indexer/up` lane starts a bounded, read-only RPC proxy for contract
  indexing; it does not start an indexer or database.

Docker with Compose and Make are the supported development entrypoints. Run
`make help` for available lanes. Before building, testing, or running a local
demo, materialize the locked dependencies:

```bash
make dapps/deps/install
make js/deps/install
```

Make targets name their owner first. App operations start with `bike-nft/`,
`escrow/`, `pay-to-play/` or `deposit/`; they select the app through the target
name. Operations across Solidity apps use `dapps/`. Shared tools and packages
use their own namespaces, such as `cam/`, `viewer/`, `wallet/` and `js/`.
Shared local release infrastructure uses `network/local/up`,
`network/local/info`, `network/local/status` and `network/local/down`;
starting it deploys no app. Use `info` for connection details and `status` for
container state and health, including stopped services.
Only `help`, `tests` and `ci` apply to the whole repository.

For example, `pay-to-play/release/setup`, `pay-to-play/release/deploy`,
`pay-to-play/release/verify` and `pay-to-play/release/rehearsal/run` belong to
the same app and release workflow. `dapps/release/rehearsal/check` runs the
rehearsals for all release-capable apps. Target names provide the operator
interface; app targets share recipes and tooling internally.

These are the explicit networked dependency steps. To check the installed
workspace and checked-in CAM bundles offline, run:

```bash
make tests/checks
make js/tests
make cam/conformance/check
```

`make dapps/tests` runs Solidity unit/scenario, fuzz, and invariant tests. `make ci`
runs the offline checks, formatting and build checks, Solidity suites, and
`js/ci` against already installed dependencies.

`make tests` runs the complete automatic test campaigns: repository checks,
Solidity unit/scenario, fuzz, and invariant tests, JS and tool checks, the live dependency-egress
check, offline Cast check, Pay-to-Play payment/recovery/refund-worker scenarios,
Escrow local scenario, and Bike NFT local integration
fuzz campaigns with reads and fixture writes. It uses network access and deploys
disposable local chains; successful cleanup removes their state.

Checks against an operator-supplied RPC, browser CDP endpoint, or release
deployment remain separate commands with explicit inputs. `make tests` does not
select those external systems or perform a release deployment.

Conformance checks find publication defects in supplied bundles; they do not
prove live contract state, wallet authority, or that a transaction will succeed.

## Solidity formatting

Normalize one first-level dapp with the repository-pinned Foundry image:

```bash
make escrow/format
```

Check formatting across every dapp without modifying files:

```bash
make dapps/format/check
```
