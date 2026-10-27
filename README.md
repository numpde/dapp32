# Contract-Defined Workflows

Contracts publish a Contract Application Manifest (CAM) describing their
workflows. Generic viewers and agents load the manifest and its resources to
render or interpret those workflows. Contracts enforce business rules and
transaction authority.

This repository contains the protocol, viewers, shared packages, and example
contracts. Current software supports CAM 1.3.0 with UI 1.0.0.

## Documentation

- [Project overview](https://numpde.github.io/dapp32/)
- [Protocol reference](https://numpde.github.io/dapp32/reference/cam/1.3.0/)
- [Examples and local demos](https://numpde.github.io/dapp32/examples/#local-demos)
- [Deployment and verification](https://numpde.github.io/dapp32/deployment/)
- [Networks](https://numpde.github.io/dapp32/deployment/networks/) and
  [RPC services](https://numpde.github.io/dapp32/deployment/rpc/)

## Example apps

- [Pay-to-Play](dapps/pay-to-play/README.md): voucher-authorized payments.
- [Escrow](dapps/escrow/README.md): agreements, disputes, and settlement.
- [Bike NFT](dapps/bike-nft/README.md): component registration and ownership.

Each app's README covers its contracts and local demo commands.

## Deployment instances

Point each operator command at one private instance directory:

```sh
make bike-nft/release/setup INSTANCE=/absolute/002-avalanche-fuji
make bike-nft/release/deploy INSTANCE=/absolute/002-avalanche-fuji
make bike-nft/release/ui/update INSTANCE=/absolute/002-avalanche-fuji
make bike-nft/release/verify INSTANCE=/absolute/002-avalanche-fuji
```

Use `escrow` or `pay-to-play` for the other apps. Setup creates the directory
and offers full, business, UI or CAM configuration. Commands create their own
record folders; updates offer saved work and component choices. `instance.json`
contains references, while the immutable artifacts retain deployment facts.
Failed operations and hosting pauses remain resumable through the same command.
Existing deployment directories are not renamed or migrated automatically.

Setup and signed operations resolve the approval tool automatically. An installed
saved image stays pinned. Otherwise the workflow reuses an image with matching
tool inputs or builds one using the locked dependency stage, then asks you to
review the configuration change. Operator images are retained for other instances;
rehearsals remove only images owned by that run after their containers stop.

`release/ui/deploy` creates a read-only Solidity UI contract and saves its
verified record. `release/ui/update` also prepares matching CAM files locally
and updates the existing CAM root to use the selected UI contract and manifest.
Upload or pin the files yourself before approving root changes. To pause after
preparation, omit `settings.CAM_URI` from the CAM configuration, host the files,
set their manifest URI, then resume. `release/cam/bundle` prepares files only;
`release/cam/publish` configures contract addresses and the manifest URI/hash
on chain. Neither command uploads files.

## Development

Use Docker with Compose and Make. Install the locked dependencies, then run
the offline checks:

```sh
make dapps/deps/install
make js/deps/install
make ci
```

`make tests` also runs networked checks and disposable local scenarios.
Run `make help` for commands, prerequisites, and operator options.
