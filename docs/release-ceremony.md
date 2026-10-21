# Release ceremony mechanics

The Escrow, Bike NFT and Pay-to-Play release lanes share one host ceremony. Application commands, authority policy, deployment artifacts, handoffs, verification claims, and live smoke tests remain in each dapp README. The unfinished deposit gateway is excluded.

`compose/release/` owns the planning, signing, artifact, and verification service boundaries. Each app supplies a small Compose overlay with its inputs and script entrypoints. Make uses both files from the selected commit's source snapshot, so deployment and verification use the same phase definitions as the contracts being checked.

## Start a local network, then deploy manually

Start the shared network first, then run each release step separately:

```sh
make network/local/up
make pay-to-play/release/setup CONFIG=/absolute/private/pay-to-play-local.json
make pay-to-play/release/deploy CONFIG=/absolute/private/pay-to-play-local.json
make pay-to-play/release/verify CONFIG=/absolute/private/pay-to-play-local.json
make network/local/down
```

Choose `local` in setup. It records the running network's Docker name, chain
31338, RPC URL `http://release-anvil:8545`, the app's CAM URI under
`http://release-cam:8080`, and the public repeated-pattern `ba` test key. Anvil's
genesis funds this key with 1,000 test ETH. Setup shows the local owner defaults;
Pay-to-Play and Escrow can keep the deployer as owner and verify immediately.
Bike NFT still requires separate lasting authorities and their ownership
handoffs, as described in its README. Every app uses the same setup and release
implementation, with its own settings.

`network/local/up` starts only Anvil and CAM hosting. Deployment and verification
attach to that existing internal Docker network and leave both services running.
`make network/local/info` checks that both services are running and prints their
connection details. `make network/local/status` shows each existing service's
container state and health status, including stopped containers. An empty table
means this project's containers do not exist. It reports status without
starting or stopping services. There are no host ports or external network access.
The RPC and CAM hostnames resolve only inside this Docker network. CAM uses
**HTTP**, so Pay-to-Play's manifest URI is
`http://release-cam:8080/pay-to-play/main.json`. The deployment and verification
containers can reach these services; your host browser cannot open that URI.
Browser or wallet testing requires a separately configured network exposure;
these commands provide container-based deployment and verification.
`network/local/down` explicitly removes this infrastructure and its chain state.
Use the same `COMPOSE_PROJECT_NAME` for network startup and setup when selecting
a nondefault project; the resulting file saves the actual Docker network name.

Local configuration files have the same off-repo, owner and mode requirements
as public release files. Commit the intended source and install locked
dependencies before setup and deployment. Local mode permits only these exact
fixture peers, app URI and chain ID; public mode retains the HTTPS RPC policy.

## Rehearse the release locally

Run the full release workflow without real funds or operator credentials:

```sh
make pay-to-play/release/rehearsal/run
```

Use `bike-nft/release/rehearsal/run` or `escrow/release/rehearsal/run` for those
apps. To rehearse all three, run `make dapps/release/rehearsal/check`.
This check is also part of `make tests`;
`make ci` keeps its offline scope. Install the locked Solidity and JS dependencies
before running either command.

The rehearsal captures current source, including uncommitted and nonignored new
files, in a private temporary Git repository. Its candidate commit identifies
the tested files; it is not the original checkout's `HEAD`. Your files, index,
and history remain unchanged. The normal release commands run from this clean
candidate and take their usual source snapshots.

The fixture starts Anvil on chain ID 31338 and serves the candidate's CAM files
at `http://release-cam:8080`. It creates protected credential files containing
public fixture values and chooses distinct intended owners. It then:

1. Calls the app's normal `release/deploy` target.
2. Calls its normal `release/verify` target and requires the pending-owner error.
3. Accepts the ownership transfers using the intended fixture accounts. For Bike
   NFT, it first checks that early admin acceptance fails, then advances Anvil's
   clock past the delay and accepts both admin transfers.
4. Loads CAM through the recorded URI, checks its digest, and loads the entry
   screen through the normal viewer's discovery and resource checks.
5. Calls the same `release/verify` target again and requires success.

The rehearsal overlays change only CAM publication policy and RPC upstream
transport. Deployment scripts, plans, artifacts, signing, method restrictions,
receipt provenance and contract verification are shared with normal releases.
Release broadcasts are sequential so each recorded transaction hash stays paired
with its submitted transaction.
Normal releases still require HTTPS/IPFS CAM references and public HTTPS RPCs.
The fixture permits only its exact private CAM origin and Anvil upstream.

All running fixture services use an internal Docker network with no host ports.
Image builds may still fetch their pinned inputs. The command removes its
services and copied dependency trees when finished, retaining the candidate
source, ordinary deployment records and per-step logs under the printed
`/tmp/cam-release-rehearsal-*` directory. Failed teardown retains the dependencies
as well so mounted state remains available for inspection.

This proves local release composition, handoffs and CAM loading. It does not
test a public RPC provider, public hosting/CORS, explorer source publication or
the live service that uses the contracts.

## Rehearse approval startup and rejection

Run the approval and host checks before rebuilding the tool image:

```sh
make js/tests
make tests/checks
```

Build the approval image from the reviewed committed tool source:

```sh
make release/approval/image/build \
  SOURCE_COMMIT=<full-40-character-commit> \
  RELEASE_APPROVAL_IMAGE_OUTPUT_DIR=<new-absolute-directory-outside-the-repository>
```

The output directory's parent must exist. Review the resulting
`approval-image.json` and use its exact `imageId` for the PTY rehearsal:

```sh
make escrow/release/approval/start/check RELEASE_APPROVAL_IMAGE=sha256:<image-id>
```

This command creates its own isolated chain and public fixture inputs. It
requires installed locked Solidity and JS dependencies, Docker Compose and
host Python 3. It displays the release identity, enters `start`, waits for the
first transaction review and rejects that transaction. The check requires an
unchanged deployer nonce and an audit with no approval or transmission.
Successful approval and receipt verification remain a separate rehearsal.

The command enables RPC tracing and prints its retained records directory.
On a first-review timeout, `signer-tail.log` and `approval-tail.log` contain
the selected container's state, exit code and OOM flag, followed by its last
80 log lines with stdout and stderr combined. These files are owner-only.
`approval-pty.log` retains the terminal transcript; `deployment/deploy.log`
is available when the launcher reaches its ordinary post-run log collection.

The listener assigns its own connection and request numbers for tracing. These
numbers correlate each request with its response, elapsed time and socket write
status across the Forge process and independent probe clients. The trace omits
caller-supplied request IDs, parameter values and response bodies.
`write=flushed` means the socket write callback completed; it does not establish
that Forge consumed the response. Closed connections, canceled requests and
failed or skipped writes remain distinguishable.

The pinned Foundry v1.7.1 uses foundry-fork-db 0.26.0. Its
[account loader](https://github.com/foundry-rs/foundry-core/blob/fork-db-v0.26.0/crates/fork-db/src/backend.rs#L311-L398)
races `eth_getAccountInfo` against balance, nonce and code reads, and falls back
on any error from the combined method. A `-32601` response to that optional
probe alone does not establish the cause of a stall. Follow the correlated
standard reads and subsequent requests before changing RPC permissions.
The listener regression covers the unsupported probe, standard reads on the
same connection and a submission held by approval. The PTY run checks the real
pinned client against the approval image.

## Deploy to the selected chain

Run the shared walkthrough once for any supported app:

```sh
make pay-to-play/release/setup CONFIG=/absolute/private/pay-to-play.json
make pay-to-play/release/deploy CONFIG=/absolute/private/pay-to-play.json
make pay-to-play/release/verify CONFIG=/absolute/private/pay-to-play.json
```

Use `escrow/release/setup` or `bike-nft/release/setup` with their corresponding
deployment and verification targets. All three setup targets use one shared
walkthrough; the target name selects the app. Choose `public` for an operator
RPC or `local` for the network started above. Public setup collects the complete
HTTPS RPC URL, funded deployer's private key, target chain ID, published CAM URI, all of the
app's authority and contract settings, and a new deployment output directory.
Secret prompts hide the URL and signing key. The final review lets you change
the inputs, cancel, or save with deployment confirmation already recorded.
Setup sends no transactions. `CONFIG` supplies the deployment inputs; deployment
also requires a separately reviewed `RELEASE_APPROVAL_IMAGE` and operator
approval in the terminal. It does not read the RPC catalog or any other
credential file.

Setup uses two separate paths: `CONFIG` stores the inputs for a future
deployment, while the output directory stores that deployment's plans,
transaction records and deployed contract addresses. Verification later reads
`artifact/deployment.json` from that output directory. Choose a new absolute
path outside the checkout, for example `/tmp/local-release`. Its parent must
already exist; leave the directory itself for deployment to create. Keep the
directory after deployment, including a failed attempt, so its records remain
available for verification or inspection.

The configuration is JSON containing the concrete RPC URL and private key,
the exact source commit, every app setting, and `confirmDeploy: true`. Local
files additionally contain `localNetwork`, the concrete Docker network name.
It must be a normalized absolute path outside the checkout, owned by the
current user with mode `0600`; every path component must be free of symlinks.
Its parent must already exist. Setup publishes without overwriting an existing
file, including a file created while the walkthrough was running. Loading
enforces the same file requirements, rejects unknown or duplicate fields, and
requires the matching app and source commit. Values are decoded as inputs;
the configuration is never executed as shell code. Saved inputs take precedence
over ambient release settings. Commit the intended source before setup.

The offline loader unpacks the saved RPC URL and, for deployment only, the
signing key into temporary owner-only files for the existing release phases.
Cleanup removes these temporary files. Verification reuses the saved output
directory to locate `artifact/deployment.json`; the verifier and its networked
services receive no signing key. Run verification after the app's required
ownership transfers have been accepted.

For callers that already supply individual environment settings, the existing
interface also remains available:

Select `RPC_CHAIN` and `RPC_SERVICE` from `make release/rpc/list`, or supply a
protected `RPC_URL_FILE` for a custom endpoint. The [RPC selection guide](rpc-services.md)
explains both modes and API-key files.

Run a release only from the exact clean commit selected for publication. The targets reject visible tracked or untracked changes, resolve one commit, and export that commit with `git archive` into a private temporary directory. Dependency verification, release checks, compilation, planning, signing, and artifact materialization all use that snapshot rather than the working tree.

The snapshot includes copies of the installed Solidity and npm dependency trees. The lanes verify those trees against the archived repository metadata before use. The npm check proves the lockfile and package graph, not an independent checksum for every installed file byte; the ceremony therefore does not claim reproducible dependency-byte provenance.

Operator-supplied RPC URL, RPC API-key and deployment-key files must be absolute, readable regular files whose path components are not symlinks. These files must not be group- or world-accessible. Verification uses the selected RPC but receives no deployment key.

Deployment requires a normalized new output directory outside the repository. The target rechecks its parent before creating the directory with mode `0700`, then creates three phase-specific subdirectories:

```text
plan/
broadcast/
artifact/
```

The offline planner writes only `plan/`. The signer reads the plan, recomputes the exact mounted CAM-root hash, holds the only deployment key, reaches the only RPC proxy admitting `eth_sendRawTransaction`, and writes only `broadcast/`. The materializer reads the plan and broadcast through a distinct read-only RPC path and writes only `artifact/`. Release files use staged, synced, no-clobber publication.

Each invocation derives private Compose project identities from its temporary ceremony directory. Cleanup addresses only those identities. Successful teardown removes the snapshot; incomplete teardown retains it and reports its path for inspection. Docker daemon and context selection remain operator-owned, so the project identity does not isolate unrelated users of the same daemon.

Deployment is one-shot. Once created, the output directory is preserved even if a later phase fails. The temporary source snapshot is retained only when cleanup is incomplete; successful cleanup removes it even after a deployment failure. Inspect the plan, Forge broadcast, and partial artifact state before authorizing any further transaction; the repository provides no automatic recovery, retry, or redeployment target.

Verification first opens the app deployment artifact through one bounded, non-symlink descriptor, strictly parses it, checks the selected source commit and checked-in CAM bytes, and publishes one canonical JSON snapshot into a container volume without overwriting an existing destination. Receipt provenance and the Solidity verifier consume only that read-only snapshot. They cannot remount the external artifact. Verification receives no signing key, exposes no transaction-submission RPC method, and does not use `--broadcast`.
