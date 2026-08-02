# Bike NFT

Bike NFT publishes its manager workflow through CAM while keeping token ownership and every privileged write on-chain. The local fixture is intentionally unsuitable for public networks: it uses zero admin delays, fixture authority, and optional demo records.

## Release policy

`make bike-nft-release-deploy` is the only supported non-fixture deployment lane. It requires four distinct kinds of input:

- publication: exact CAM URI and bytes;
- collection identity: name, symbol, base token URI, and collection metadata URI;
- governance: final `CamRoot`, component-token, and manager authorities plus nonzero default-admin delays;
- operations: explicit pauser, configurer, and one or more unique registrar addresses.

The funded deployer must differ from every lasting authority. The same final account may deliberately hold several declared roles, but the release does not infer that policy. It deploys no demo records, gives the manager only the token mint and URI-setter roles, removes the deployer's ordinary roles, and starts three independent handoffs:

1. `CamRoot.acceptOwnership()` by the final root owner;
2. `BicycleComponents.acceptDefaultAdminTransfer()` by the final component admin after its delay;
3. `BicycleComponentManager.acceptDefaultAdminTransfer()` by the final manager admin after its delay.

Until all three calls complete, the deployer remains a temporary default admin where OpenZeppelin's delayed transfer requires it, and `make bike-nft-release-verify` intentionally fails.

Choose the authority addresses and delays before creating a release plan. A production-like Sepolia rehearsal should normally use a disposable funded deployer, a testnet Safe or separate owner for final administration, a separate registrar, and explicitly controlled pauser/configurer accounts. The release lane requires a nonempty base URI and collection URI; this is a stricter publication policy than the contracts themselves, which permit empty constructor values.

## CAM publication

Publish the entire checked-in directory without reformatting or newline normalization:

```text
cam/
  main.json
  ui.json
  abi/
    BicycleComponentManager.json
    BicycleComponentManagerUI.json
```

Use an immutable or versioned HTTPS origin with JSON content types and browser-readable CORS. Before any release ceremony, run:

```bash
make format DAPP=bike-nft
git diff --check
git diff --exit-code
make cam-publication-preflight DAPP=bike-nft CAM_URI=https://published.example/bike-nft/v1/main.json
make bike-nft-release-check
make checks
make fmt
make build
make script-build
make test
make package-test
```

The publication preflight prints the `CAM_HASH`; the deploy planner recomputes it from the exact mounted `main.json`, and the Solidity signer independently hashes the same binary file immediately before broadcast.

## Release deployment

No RPC or key is needed for `make bike-nft-release-check`. A real deployment additionally requires protected absolute files:

```bash
umask 077
printf '%s\n' 'https://<provider-sepolia-rpc>' > /secure/bike-nft-sepolia-rpc
printf '%s\n' '0x<32-byte-disposable-deployer-key>' > /secure/bike-nft-sepolia-deployer
```

Example Sepolia input shape (chain ID `11155111`):

```bash
CONFIRM_BIKE_NFT_RELEASE_DEPLOY=YES \
BIKE_NFT_RELEASE_EXPECTED_CHAIN_ID=11155111 \
BIKE_NFT_RELEASE_CAM_URI=https://published.example/bike-nft/v1/main.json \
BIKE_NFT_RELEASE_INTENDED_CAM_ROOT_OWNER=0x<intended-root-owner> \
BIKE_NFT_RELEASE_TOKEN_NAME='Bicycle Components' \
BIKE_NFT_RELEASE_TOKEN_SYMBOL=BIKE \
BIKE_NFT_RELEASE_BASE_TOKEN_URI=https://published.example/bike-nft/v1/tokens/ \
BIKE_NFT_RELEASE_COLLECTION_URI=https://published.example/bike-nft/v1/collection.json \
BIKE_NFT_RELEASE_INTENDED_COMPONENTS_ADMIN=0x<intended-components-admin> \
BIKE_NFT_RELEASE_COMPONENTS_ADMIN_DELAY=86400 \
BIKE_NFT_RELEASE_COMPONENTS_PAUSER=0x<components-pauser> \
BIKE_NFT_RELEASE_COMPONENTS_CONFIGURER=0x<components-configurer> \
BIKE_NFT_RELEASE_INTENDED_MANAGER_ADMIN=0x<intended-manager-admin> \
BIKE_NFT_RELEASE_MANAGER_ADMIN_DELAY=86400 \
BIKE_NFT_RELEASE_MANAGER_PAUSER=0x<manager-pauser> \
BIKE_NFT_RELEASE_MANAGER_CONFIGURER=0x<manager-configurer> \
BIKE_NFT_RELEASE_REGISTRARS=0x<registrar-one>,0x<registrar-two> \
RPC_URL_FILE=/secure/bike-nft-sepolia-rpc \
DEPLOYER_PRIVATE_KEY_FILE=/secure/bike-nft-sepolia-deployer \
BIKE_NFT_RELEASE_OUTPUT_DIR=/secure/releases/bike-nft-sepolia-v1 \
make bike-nft-release-deploy
```

This command is documentation for a future ceremony, not a command to run while preparing the repository. The output directory is new, external, mode `0700`, and split by authority:

```text
plan/release-plan.json
broadcast/DeployBikeNftRelease.s.sol/<chain-id>/run-latest.json
artifact/deployment.json
```

The clean-tree check rejects visible uncommitted work that the selected commit archive would omit. The target then exports that exact commit into a private temporary ceremony directory; this archive owns the source used for dependency verification, release checks, compilation, planning, signing, and artifact generation. Each invocation also derives unique Compose project names from the private directory, so concurrent release commands do not share Compose resources. The snapshot is removed after successful teardown and retained for inspection if cleanup is incomplete.

The planner can write only `plan/`; the signer reads `release-plan.json` directly, independently compares every operator-owned field, recomputes the exact CAM-byte hash, and writes only `broadcast/`; the materializer reads the plan and broadcast and writes only `artifact/`. Only the signer has the deployment key and a route to an RPC proxy admitting `eth_sendRawTransaction`. The artifact proxy has neither. Verification accepts `deployment.json` as its sole external artifact and stages one canonical snapshot for its receipt and Solidity checks.

After independently accepting all three handoffs, verify from the same exact clean commit:

```bash
RPC_URL_FILE=/secure/bike-nft-sepolia-rpc \
BIKE_NFT_DEPLOYMENT_ARTIFACT_FILE=/secure/releases/bike-nft-sepolia-v1/artifact/deployment.json \
make bike-nft-release-verify
```

Verification has no signing key or send-capable RPC method. It rechecks all four creation receipts, exact source/runtime and artifact code hashes, CAM identity and bindings, UI and manager backing, completed ownership/admin handoffs, absence of pending admin-delay changes, exact delays and metadata, current unpaused state, the manager's default delegation duration, required roles, deployer role removal, and interface support.

## Public rehearsal

Configure the generic CAM web viewer with the public chain ID, a public read RPC, the deployed `CamRoot` address, the published CAM resource origin, and wallet/network switching. Hosting and wallet injection are deployment-provider concerns; this repository does not yet own a public hosting target.

Exercise registrar creation, token receipt, metadata update, missing/report resolution, delegation grant/revoke, transfer with permission changes, pause/unpause, and unauthorized failures. Verify explorer metadata and rerun `make bike-nft-release-verify` after activity. Explorer source publication is advisable but remains separate from the repository's bytecode verifier.

## Explicit uncertainties and limits

- `AccessControlDefaultAdminRules` is not enumerable. Verification proves every declared holder is present and the deployer is absent; it cannot enumerate the universe of undisclosed third-party role holders from current state alone. The clean pinned script and preserved broadcast remain part of the audit evidence.
- The repository does not choose the actual Safe/EOA addresses, the final nonzero delay, RPC provider, CAM host, browser host, block explorer, or operator finality threshold.
- Docker daemon/context selection remains operator-owned. Release targets generate a private Compose project name per invocation; this isolates repository-owned resources but does not isolate unrelated access to the selected daemon.
- The commit snapshot includes the installed npm tree after checking it against the archived lockfile and package graph. The repository does not yet prove every installed npm file byte against an independent checksum set; do not describe the snapshot as reproducible dependency-byte provenance.
- Deployment is one-shot. A post-transaction failure preserves the plan and broadcast; inspect them before any further transaction. There is no automatic recovery or redeployment target.
- The release artifact records operator intent and immutable deployment provenance, not a mutable snapshot of every later handoff state. Live verification is the authority for accepted ownership and administration.

No upgrade, recovery, hidden registrar, generic CAM machine resource, or production monitoring authority is introduced by this lane.
