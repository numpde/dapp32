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
make bike-nft/release/source/publish INSTANCE=/absolute/002-avalanche-fuji
```

Use `escrow` or `pay-to-play` for the other apps. Setup creates the directory
and offers full, business, UI or CAM configuration. Commands create their own
record folders; updates offer saved work and component choices. `instance.json`
contains references, while the immutable artifacts retain deployment facts.
Failed operations and hosting pauses remain resumable through the same command.
Existing deployment directories are not renamed or migrated automatically.
The instance configuration supplies defaults and credentials. Operations retain
their own source, settings and approval-tool choices without overwriting those
defaults. Retained inputs reference the protected credential file rather than
copying its RPC URL or signing key. Editing defaults does not change saved work;
resuming a signing phase requires its selected source revision.

Setup and signed operations resolve the approval tool automatically. An installed
saved image stays pinned. Otherwise the workflow reuses an image with matching
tool inputs or builds one using the locked dependency stage. The selected image
is recorded for the operation. Operator images are retained for other instances;
rehearsals remove only images owned by that run after their containers stop.
A saved signing operation requires its recorded image. If that image was removed,
restore it to resume signing; keyless verification does not require the image.

`release/ui/deploy` creates a read-only Solidity UI contract and saves its
verified record. `release/ui/update` also prepares matching CAM files locally
and updates the existing CAM root to use the selected UI contract and manifest.
Upload or pin the files yourself before approving root changes. To pause after
preparation, omit `settings.CAM_URI` from the CAM configuration, host the files,
then repeat the command to enter their manifest URI. That URI is retained for
publication; no configuration edit is required. `release/cam/bundle` prepares files only;
`release/cam/publish` configures contract addresses and the manifest URI/hash
on chain. Neither command uploads files.

Completed instance deployment commands also submit their contracts' original
sources to Sourcify for public verification. This runs after deployment cleanup,
without an RPC credential or signing key. Rehearsals do not submit public sources.
An external service failure leaves the completed deployment intact; retry with
`release/source/publish`. This command offers saved business, UI, CAM-root and
historical full-deployment records, and never deploys or changes bindings.

Public verification uses the selected deployment's retained compiler artifacts
and original Git revision, not today's source. Installed dependency source must
match the compiler metadata hashes; restore the matching dependencies if it does
not. Missing history or compiler artifacts fails before submission. Only the
metadata-listed source files and compiler settings are sent to Sourcify.
The chain must be supported by Sourcify.

Requests and resumable job/results records live beside the selected deployment
under `source-publication/<deployment-artifact-sha256>/`. A retry resumes pending
jobs and keeps failed attempts. Output distinguishes exact matches from matches
with differing compiler metadata. An already-verified response is accepted only
when both bytecodes match exactly and the stored metadata equals our original
compiler metadata. Original deployment artifacts remain unchanged.

`release/verify` checks our deployment evidence against the chain; it does not
submit sources externally. Public source verification does not guarantee wallet
decoding or publish an ERC-7730 descriptor. See the
[wallet decoding note](notes/030_wallet_transaction_decoding_and_clear_signing.txt).

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
