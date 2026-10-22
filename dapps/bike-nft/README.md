# Bike NFT

Bike NFT publishes its manager workflow through CAM while keeping token ownership and every privileged write on-chain. The local fixture is intentionally unsuitable for public networks: it uses zero admin delays, fixture authority, and optional demo records.

## Try the local workflow

From the repository root, install the locked dependencies with `make dapps/deps/install` and
`make js/deps/install`, then choose one demo. Each demo deploys a fresh disposable fixture before
starting its viewer:

```bash
make bike-nft/local/demo/gui/up
```

Open the full URL printed by the command. The initial viewed account is the
local fixture account, which grants no wallet access. Reads work without a
wallet. **Connect wallet** changes the viewed account to the injected wallet
account. A write button prepares and simulates a call; **Send with wallet** requests
its submission after review. On-chain roles and ownership determine
whether the transaction can execute.

Use the exact serial text, including case and spaces. To register an unused
serial, choose **Look up component**, then **Check registration** when available.
The registrar sends the transaction; the initial NFT owner may be another
account. Token metadata, missing reports and resolutions use nonempty URIs;
these controls store locations rather than uploading files or calculating
document digests.

Unavailable actions and their inputs stay visible and disabled. Registry pause,
component-token pause and the viewed account's registrar role are separate facts.
On a component view, editing the lookup serial does not change the displayed
loaded component or the target of its writes; look up the new serial first.

The current owner can take a component out of service and reactivate it later.
This lifecycle flag is independent of missing reports: neither operation opens
or resolves a report. Metadata corrections and ordinary NFT transfers remain
available in either lifecycle state.

To authorize a workshop, enter its address on the component view and choose
an access duration within the displayed maximum. Inspect the grant and preview
its exact onchain expiry, then choose a named permission preset. Each preset
replaces the existing permissions and expiry. Revoke access for the inspected
workshop with **Revoke workshop access**. Workshop grants
authorize only the selected registry actions and provide no NFT transfer
approval. Every ownership change permanently invalidates earlier grants, even
if the token returns to the grantor. Self-transfers preserve grants; failed
transfers leave them unchanged.

Handover prepares a direct ERC-721 safe transfer from the current owner to the
recipient using the loaded record's collection and token ID. Review both
addresses before sending. This operation transfers token ownership; it does
not collect payment or verify physical delivery. Registry pause does not stop
token transfers, while the recorded collection's pause does.

These workflows require fresh contracts. Previously deployed irreversible
`Retired` records retain their original meaning; migration is outside this
workflow.

After connection, wallets that report account and network changes update the
viewer automatically and clear unsent prepared calls. After an account change,
wait for the refreshed view, check the account and chain, then prepare anew.
A different wallet network leaves the viewer's configured chain and RPC
unchanged and disables sending until the wallet returns to that chain.
Disconnecting retains the last successful read-only view. Submitted transaction
hashes and receipt tracking survive wallet changes. If your provider cannot
report changes, use **Switch wallet** to reconnect after changing accounts or
networks.

For a terminal that reads the real local RPC and prepares writes without signing
or submitting them, run:

```bash
make bike-nft/local/demo/terminal/up
```

Both commands deploy disposable fixtures and attempt cleanup when their
foreground command exits. Chain state is removed only when cleanup succeeds.
Closing the browser tab does not stop the GUI. If interruption or cleanup
failure leaves a project running, use the matching cleanup target:

```bash
make bike-nft/local/demo/gui/down
make bike-nft/local/demo/terminal/down
```

The Bike fixture and release lane both pin SHA-256 of the exact CAM manifest
bytes. CAM also authenticates the bundled protocol reference before ABI/UI
loading.

## Release policy

`make bike-nft/release/deploy` is the only supported non-fixture deployment lane. It requires four distinct kinds of input:

- publication: exact CAM URI and bytes;
- collection identity: name, symbol, base token URI, and collection metadata URI;
- governance: final `CamRoot`, component-token, and manager authorities plus nonzero default-admin delays;
- operations: explicit pauser, configurer, and one or more unique registrar addresses.

The funded deployer must differ from every lasting authority. The same final account may deliberately hold several declared roles, but the release does not infer that policy. It deploys no demo records, gives the manager only the token mint and URI-setter roles, removes the deployer's ordinary roles, and starts three independent handoffs:

1. `CamRoot.acceptOwnership()` by the final root owner;
2. `BicycleComponents.acceptDefaultAdminTransfer()` by the final component admin after its delay;
3. `BicycleComponentManager.acceptDefaultAdminTransfer()` by the final manager admin after its delay.

Until all three calls complete, the deployer remains a temporary default admin where OpenZeppelin's delayed transfer requires it, and `make bike-nft/release/verify` intentionally fails.

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
    BicycleComponents.json
```

Use an immutable or versioned HTTPS origin with JSON content types and browser-readable CORS. Before any release ceremony, run:

```bash
make bike-nft/format
git diff --check
git diff --exit-code
make bike-nft/cam/publication/preflight CAM_URI=https://published.example/bike-nft/v1/main.json
make bike-nft/release/check
make tests/checks
make dapps/format/check
make dapps/build
make dapps/scripts/build
make dapps/tests/unit-scenario
make js/tests
```

The publication preflight prints the exact-byte SHA-256 `CAM_HASH`; the deploy planner recomputes it from the exact mounted `main.json`, and the Solidity signer independently hashes the same binary file immediately before broadcast.

## Release deployment

For guided setup, run `make bike-nft/release/setup CONFIG=/absolute/private/bike-nft.json`,
then `make bike-nft/release/deploy CONFIG=/absolute/private/bike-nft.json`.
The [shared walkthrough](../../docs/release-ceremony.md#deploy-to-the-selected-chain)
saves every app input, concrete RPC URL, signing key and deployment confirmation
in one protected off-repo file. Use the same `CONFIG` for release verification.

The `bike-nft.release-plan.v2` and `bike-nft.deployment.v2` schemas identify SHA-256 manifest commitments. Older v1 artifacts retain their Keccak meaning and are rejected by these lanes. Publish the manifest together with every declared protocol/ABI/UI resource.

Shared source-snapshot, secret-file, output, Compose-isolation, one-shot, and verification-snapshot rules are documented in [the release ceremony guide](../../docs/release-ceremony.md).

No RPC or key is needed for `make bike-nft/release/check`. A real deployment additionally requires these app inputs:

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
make bike-nft/release/deploy
```

This command is documentation for a future ceremony, not a command to run while preparing the repository. The Bike output contains:

```text
plan/release-plan.json
broadcast/DeployBikeNftRelease.s.sol/<chain-id>/run-latest.json
artifact/deployment.json
```

After independently accepting all three handoffs, verify from the same exact clean commit:

```bash
RPC_URL_FILE=/secure/bike-nft-sepolia-rpc \
BIKE_NFT_DEPLOYMENT_ARTIFACT_FILE=/secure/releases/bike-nft-sepolia-v1/artifact/deployment.json \
make bike-nft/release/verify
```

Verification rechecks all four creation receipts, exact source/runtime and artifact code hashes, CAM identity and bindings, UI and manager backing, completed ownership/admin handoffs, absence of pending admin-delay changes, exact delays and metadata, current unpaused state, the manager's default delegation duration, required roles, deployer role removal, and interface support.

## Public rehearsal

Configure the generic CAM web viewer with the public chain ID, a public read RPC, the deployed `CamRoot` address, the published CAM resource origin, and wallet/network switching. Hosting and wallet injection are deployment-provider concerns; this repository does not yet own a public hosting target.

The viewer URL supplies `chainId` (for example `eip155:11155111`), `host`, `account`, and `rpcUrl`. The hosting configuration supplies `VITE_CAM_WEB_RESOURCE_ORIGIN`; links cannot override that resource origin. Use a credential-free public read RPC because its URL is included in shareable read links. Such links reopen a route against current state and do not carry wallet authority, unsent form edits, or prepared transactions.

Exercise registrar creation, token receipt, metadata update, missing/report resolution, delegation grant/revoke, transfer with permission changes, pause/unpause, and unauthorized failures. Verify explorer metadata and rerun `make bike-nft/release/verify` after activity. Explorer source publication is advisable but remains separate from the repository's bytecode verifier.

## Explicit uncertainties and limits

- `AccessControlDefaultAdminRules` is not enumerable. Verification proves every declared holder is present and the deployer is absent; it cannot enumerate the universe of undisclosed third-party role holders from current state alone. The clean pinned script and preserved broadcast remain part of the audit evidence.
- The repository does not choose the actual Safe/EOA addresses, the final nonzero delay, RPC provider, CAM host, browser host, block explorer, or operator finality threshold.
- The release artifact records operator intent and immutable deployment provenance, not a mutable snapshot of every later handoff state. Live verification is the authority for accepted ownership and administration.

No upgrade, recovery, hidden registrar, generic CAM machine resource, or production monitoring authority is introduced by this lane.
