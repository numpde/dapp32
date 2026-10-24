# Contract-Defined Workflows

This repository explores contract-defined workflows. A contract publishes a
Contract Application Manifest (CAM) URI and hash, and binds the contract
addresses used by its routes. Generic viewers and agents can load the bundle,
verify its bytes, and render or interpret the workflow. The called contracts
enforce business rules; a manifest or viewer cannot grant transaction authority.

The goal is to make dapp workflows portable, inspectable, and closer to the
contracts that authorize them.

Project overview: <https://numpde.github.io/dapp32/>

Current software supports CAM 1.3.0 with UI 1.0.0: [protocol reference](https://numpde.github.io/dapp32/reference/cam/1.3.0/). Earlier reference versions remain available as historical documentation; current software rejects those manifest versions.

## Start here

To explore an app or manually test its contracts, CAM bundle and viewer together,
use its `local/demo/gui/up` target. Each launcher starts a disposable local chain,
deploys fresh app contracts, serves CAM resources and prints the viewer URL.
Keep the command running while using the demo; exiting attempts cleanup of its
temporary state. See [local demo launchers](https://numpde.github.io/dapp32/examples/#local-demos)
for the three commands, wallet requirements and how they differ from release deployment.

- [Pay-to-Play](dapps/pay-to-play/README.md): deposit native coins, register a
  permanent voucher key, and authorize cumulative payments. Explains delayed
  withdrawals, full refunds, channel retirement, service integration and the local demo.
- [Escrow](dapps/escrow/README.md): create and fund an agreement, review work,
  resolve disputes, and withdraw settlement credit. Includes a local browser
  demo and an automated nine-path workflow.
- [Bike NFT](dapps/bike-nft/README.md): register bicycle components and manage
  ownership, metadata, reports, and delegation. Includes local demos and release
  authority handoffs.
- [Deployment guide](https://numpde.github.io/dapp32/deployment/): shared deployment mechanics,
  credential files, evidence, and read-only verification.
- [EVM networks and testnets](https://numpde.github.io/dapp32/deployment/networks/): browse the RPC catalog by
  stable network index, with mainnet/testnet views and authoritative references.
- [Select an RPC service](https://numpde.github.io/dapp32/deployment/rpc/): use the executable chain/service
  catalog with deployment commands, or supply your own endpoint. The separate
  [indexing proxy lane](https://numpde.github.io/dapp32/deployment/rpc/#indexing)
  starts a bounded, read-only RPC proxy for contract indexing; run the indexer
  and database separately.
- [IPFS HTTPS gateways](js/tools/ipfs-gateways.json): public gateways and account-based
  retrieval services, including URL templates, gateway tokens, content restrictions
  and official references. The viewer's gateway selector uses its public file
  endpoints; deployment commands do not load gateway credentials from it.

In the browser, **IPFS gateway** selects the public endpoint for new CAM, NFT
and document downloads. Changing it retries an unfinished initial app load;
an open app keeps its view, form entries, wallet and transaction feedback.
The terminal viewer uses the catalog's default public gateway. Dedicated
gateway credentials and CAR-only services are not options in the dropdown.
Gateway transport preserves the logical `ipfs://` resource names and the
existing CAM hash checks; it does not add IPFS block verification.

To attach the viewer to a public-chain deployment, run `make viewer/release/up`.
It asks for `deployment.json`, derives the app and HTTPS resource origin, and
offers the artifact chain's public RPC from the catalog or a custom URL. IPFS
bundles need no HTTP origin pin. To deploy a general-purpose viewer, set
`RESOURCE_ORIGIN='*'` to permit any validated HTTP(S) CAM resource origin.
Set `RESOURCE_ORIGIN=none` to disable HTTP(S) CAM downloads, or supply the
artifact's HTTP(S) origin to keep downloads pinned. The default remains the
artifact-derived origin, with HTTP(S) disabled for IPFS bundles.
These launch settings choose the initial **CAM resources** selection. On the
page you can allow any HTTP(S) origin, pin to the manifest's HTTP(S) origin, or
disable HTTP(S). The choice remains available if loading fails; changing it
retries an unfinished load. An open app keeps its view and drafts: the new
selection applies to subsequent CAM downloads, leaving loaded content and
already-started requests intact. Viewer URL parameters cannot set this choice.
For other browser deployments the equivalent build setting is
`VITE_CAM_WEB_RESOURCE_ORIGIN` (`*`, `none`, or a literal origin); an unset or
empty setting disables HTTP(S). Browser CORS and mixed-content restrictions
still apply. Resource URL validation, redirect refusal, byte limits, cancellation
and integrity checks remain in effect; this policy adds no backend proxy.
The RPC URL is visible in the browser link, so use a browser-public endpoint.
This command does not read a signing configuration or private key. For scripts,
supply `DEPLOYMENT_ARTIFACT_FILE` and `PUBLIC_RPC_URL` directly; no prompts appear.

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

If sending completed but artifact collection failed, keep the deployment records
and run the app's `release/artifact` target with the saved `CONFIG`. It reads the
chain without a signer; do not repeat `release/deploy` to recover the artifact.
Artifact completion uses the saved app source. Its JavaScript dependencies must
match that source too. If they differ from the current checkout, prepare a
checkout at the saved commit and run `make js/deps/install` there, then use:

```bash
make bike-nft/release/artifact CONFIG=/absolute/path/to/config.json \
  RELEASE_ARTIFACT_NODE_MODULES_DIR=/absolute/path/to/saved-checkout/js/node_modules
```

The same option applies to Escrow and Pay-to-Play. Recovery checks the selected
dependency graph offline before starting its read-only RPC proxy. It does not
install dependencies automatically.

For deployments started with environment inputs rather than a saved configuration,
artifact completion accepts a read-only configuration containing `schemaVersion: 3`,
`app`, the original `sourceCommit`, `rpcUrl`, and `settings: {"OUTPUT_DIR": "..."}`.
Local fixture records also require their `localNetwork`. No signing key is needed.
Protect the file because the RPC URL may contain credentials.

`dapps/deps/install` and `js/deps/install` are the explicit networked dependency
steps. To check the installed
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

For a compiler upgrade, run `make js/compiler/qualify` in each checkout with
its corresponding locked dependencies installed. This uses the normal offline
JS lane: it prints the actual compiler version, builds packages, and fully
typechecks the web app and its tests. Each command has a 120-second deadline;
a failed step stops the workload and returns a failure status.

The reported time covers that workload. The cgroup v2 peak covers the whole
fresh container, including dependency verification, source staging and tmpfs;
it is not compiler-process RSS. Missing or invalid memory metrics fail
qualification. A fresh workspace has no compiler cache; OS page caches are
not cleared. Compare matching workloads and container limits. This command
does not replace `make js/ci` and sets no CI performance threshold.

The workspace pins native TypeScript 7.0.2. The shared compiler configuration
and the web app's standalone configuration use one checker to reduce duplicated
type-checking work within the existing 1 GiB containers. Full dependency
declaration checks remain enabled.

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
