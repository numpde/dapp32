# Bike NFT

Bike NFT publishes its manager workflow through CAM while keeping token ownership and every privileged write on-chain. The local fixture is intentionally unsuitable for public networks: it uses zero admin delays, fixture authority, and optional demo records.

## Try the local workflow

`make bike-nft/local/integration/fuzz/fixture-writes/run` runs a deterministic
three-signer scenario before the seeded random walk: seller registration,
workshop delegation and metadata update, NFT handover to a distinct buyer,
loss of seller/workshop authority (including on-chain `Unauthorized`
simulations), and a buyer metadata update. It uses deliberately public demo
keys funded only on the private disposable Bike Anvil service. A successful
scenario emits `bike_actor_ok`; the subsequent generic random walker remains
single-account and does not itself establish distinct-actor coverage.

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

The demo seeds `DEMO-FRAME-001`, `DEMO-BATTERY-001` and `DEMO-MOTOR-001`.
Their NFT metadata and distinct PNG illustrations are served locally from
`cam/components/`. Open a component, choose **Load metadata**, then **Load image**.
The fixture derives these URLs from its `CAM_URI`, which must end in
`/main.json`; the JSON uses relative image filenames so the same files work
through the browser gateway and the internal resource server.

To use the shared local fixture wallet in an existing CDP browser tab, keep this
foreground attachment running alongside the demo:

```sh
make viewer/local/fixture-wallet/attach \
  FIXTURE_WALLET_APP=bike-nft CDP_TARGET_ID='<existing-tab-id>' \
  CDP_ORIGIN=http://127.0.0.1:9222 VIEWER_URL='<printed viewer URL>' \
  EXPECTED_CAM_URI='<camManifest URI>' EXPECTED_CAM_HASH=0x... \
  EXPECTED_CONTRACT_ADDRESSES='{"BicycleComponentManager":"0x...","BicycleComponents":"0x..."}'
```

Read the manifest URI and SHA-256 digest from `camManifest()` on the printed CAM
host, and the two addresses from its `contractAddress(string)` bindings. Use the
namespace names shown above without the `contracts.` prefix.

Connect the app wallet after attachment. Its selector starts as **seller** and
also offers **mechanic** and **buyer**, using the public `ba`, `bd` and `bc`
repeated-byte fixture keys respectively. The seller is the local deployer.
Manager writes and the three-argument `safeTransferFrom` are allowed only at
their pinned destinations. Transfers to other collections are rejected.

Attachment does not fund accounts. Before sending, arrange local fixture gas
for mechanic and buyer separately. See the [shared wallet guide](../../js/tools/browser-fixture-wallet.html)
for browser setup, deployment checks, confirmation and attachment lifecycle.

Use the exact serial text, including case and spaces. To register an unused
serial, choose **Look up component**, then **Check registration** when available.
The registrar sends the transaction; the initial NFT owner may be another
account. Token metadata, missing reports and resolutions use nonempty URIs.
The metadata field offers **JSON URL** or **Embed JSON**. The active form supplies
the transaction URI directly; there is no separate apply step. Embedded metadata
initializes the editor from the existing document without changing its URI.
Editing preserves attributes and extension fields; **Advanced JSON** exposes the
full document. Empty or invalid active input has no URI and cannot prepare the
metadata transaction. Other owner actions remain available.

The NFT viewer receives its URI from the contract projection. **Load preview**
loads the JSON and its image. Embedded images display without network access;
HTTP(S) and IPFS downloads use the browser and selected IPFS gateway. JSON is
bounded to 256 KiB; PNG, JPEG, WebP and GIF images are bounded to 4 MiB. Remote
servers must allow browser CORS access. The editor does not upload files.

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

## Deployment

See the [published Bike NFT deployment guide](https://numpde.github.io/dapp32/deployment/bike-nft/) for release inputs, authority handoffs and verification. The [shared deployment guide](https://numpde.github.io/dapp32/deployment/) explains the release workflow.
