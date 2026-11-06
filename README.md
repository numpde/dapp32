# Contract-Defined Workflows

Contracts publish a Contract Application Manifest (CAM) describing their
workflows. Generic viewers and agents load the manifest and its resources to
render or interpret those workflows. Contracts enforce business rules and
transaction authority.

This repository contains the protocol, viewers, shared packages, and example
contracts. Current software supports CAM 1.4.0 with UI 1.1.0.

## Documentation

- [Project overview](https://numpde.github.io/dapp32/)
- [Protocol reference](https://numpde.github.io/dapp32/reference/cam/1.4.0/)
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

On local Linux Docker engines, host-owned release and CAM-maintenance tools
measure the selected engine's default user namespace and run as the container
UID/GID that maps back to the invoking host owner. Ordinary rootful and
operator-owned rootless Docker work without changing the instance directory's
`0700` permissions, changing ownership, or setting `LOCAL_UID=0`. Host and
container identities remain distinct. Unmapped owners or uncertain probe
cleanup stop the operation before private inputs are opened. Fixed-identity
services retain their own policy.

The host-side probe requires Python 3.11+ and the released
[linux-idmap 0.3.0](https://github.com/numpde/container-tools/releases/tag/v0.3.0)
package. Its checksum-pinned wheel is acquired automatically on first use and
cached under `~/.cache/dapp32/linux-idmap/`; subsequent runs check and reuse
it without pip or network access. The selected engine must have the pinned
Python probe image; release commands acquire it before probing. This is a
local-Linux facility, not support for remote Docker or Docker Desktop's
VM-based bind mounts.

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
`release/source/publish`. Its menu lists individual contracts across the saved
records, deduplicated by chain and address. Each entry shows the address, network,
recorded source revision, explorer and creation transaction links, and current
Sourcify publication status. A failed lookup stays unknown. Enter selects all
contracts in the deployment selected by `instance.json`; individual or
comma-separated numbers can select other contracts, including an original UI
that was replaced. Deployment membership comes from the saved CAM record, not a
fresh on-chain binding lookup. The command never deploys or changes bindings.
The menu shows Sourcify's bytecode matches for each address. After selection the
publisher compares existing public verifications with the original solc metadata
from each deployment's retained Forge artifact (`rawMetadata`).

Public verification uses the selected deployment's retained compiler artifacts
and original Git revision, not today's source. Installed dependency source must
match the compiler metadata hashes; restore the matching dependencies if it does
not. Missing history or compiler artifacts fails before submission. Only the
metadata-listed source files and compiler settings are sent to Sourcify.
The chain must be supported by Sourcify.

Prepared requests stay beside their deployment records under
`source-publication/<deployment-artifact-sha256>/`. Manual and automatic instance
publication share per-chain/address jobs under `source-publication/state/`.
Existing per-operation jobs are imported against their retained requests,
preserving their job IDs and history. A retry resumes
pending jobs and keeps failed attempts. Output distinguishes exact matches from matches
with differing compiler metadata. When Sourcify reports that another verification already exists (HTTP 409),
a retry looks it up by address. The publisher requires exact creation and
runtime bytecode matches and the original solc metadata. For its own successful
jobs, each bytecode match must be at least as strong as the saved job receipt.
Each public recheck writes the latest lookup to
`state/<chain>-<address>.public-check.json`. A mismatch records the reason,
the original metadata and the response alongside the historical job receipt.

`release/verify` checks our deployment evidence against the chain; it does not
submit sources externally. Public source verification does not guarantee wallet
decoding or publish an ERC-7730 descriptor. See the
[wallet decoding note](notes/030_wallet_transaction_decoding_and_clear_signing.txt).

## Development

Development uses `main`; published documentation lives on `gh-pages`.
Both branches are protected against deletion and force pushes. The historical
proof of concept is preserved at the
[`archive/poc-2026-05-20` tag](https://github.com/numpde/dapp32/tree/archive/poc-2026-05-20).

Use Docker with Compose and Make. Install the locked dependencies, then run
the offline checks, selecting the local Docker context for each operation:

```sh
make dapps/deps/install DOCKER_CONTEXT=your-local-context
make js/deps/install DOCKER_CONTEXT=your-local-context
make ci DOCKER_CONTEXT=your-local-context
```

Replace `your-local-context` with a context from `docker context ls`, or omit
`DOCKER_CONTEXT` to choose a local context interactively. Each operation
resolves the selected context to its local Unix socket once; child operations and
cleanup use that endpoint. Noninteractive commands require the context on the
Make command line.

Compose services with their own network namespace disable Multipath TCP. This
requires the host kernel to expose the per-namespace `net.mptcp.enabled` setting.
Browser tools that use host networking share the host's network settings instead.

`make tests` also runs networked checks and disposable local scenarios.
Run `make help` for commands, prerequisites, and operator options.
