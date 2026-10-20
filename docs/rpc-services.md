# Select an RPC service

The deploy and verify commands for Bike NFT, Escrow and Pay-to-Play can select
an endpoint from the repository's [RPC catalog](../tools/rpc-catalog.json).
List the exact network names, chain IDs and service URL templates with:

```sh
make release/rpc/list
```

The catalog currently covers Ethereum, Base, Arbitrum, Optimism and Polygon,
with mainnet and application-testnet entries. It is the executable source of
endpoint mappings; this guide does not maintain another endpoint table.

## Use a catalog endpoint

Add these settings to your existing release configuration:

```sh
export RPC_CHAIN=base-sepolia
export RPC_SERVICE=public
export PAY_TO_PLAY_RELEASE_EXPECTED_CHAIN_ID=84532
make pay-to-play/release/deploy
```

The other required release settings still apply: CAM publication, intended
owners, funded deployer, protected signing-key file, confirmation and output
directory. See the [release ceremony](release-ceremony.md).

`public` selects the shared no-key endpoint recorded for that chain. It does
not search for alternatives or promise unlimited capacity. For an Alchemy
endpoint, use an owner-only API-key file outside the repository:

```sh
export RPC_CHAIN=base-sepolia
export RPC_SERVICE=alchemy
export RPC_API_KEY_FILE=/absolute/path/to/alchemy-api-key
make pay-to-play/release/deploy
```

The file contains just the API key, optionally followed by one newline, not a
URL or JSON document. The resolver accepts 1–256 ASCII letters, digits,
underscores or hyphens. Do not put the key into a command-line argument.

Use the same `RPC_CHAIN`, `RPC_SERVICE` and optional `RPC_API_KEY_FILE` settings
with any app's `release/verify` command. Verification still needs its deployment
artifact and checks the live chain against that artifact. Ethereum Sepolia,
Base Sepolia, Arbitrum Sepolia and OP Sepolia are separate chains with separate
balances and deployments.

## Use a custom endpoint

For Quicknode, another provider, or your own public HTTPS node, copy the complete
issued URL into an owner-only file and select it explicitly:

```sh
unset RPC_CHAIN RPC_SERVICE RPC_API_KEY_FILE
export RPC_URL_FILE=/absolute/path/to/rpc-url
make pay-to-play/release/deploy
```

Conversely, unset `RPC_URL_FILE` before selecting a catalog endpoint. Mixing the
two modes, supplying a key for `public`, missing an Alchemy key, or selecting an
unknown/unavailable entry is an error. The commands never fall back to another
service. A service omitted from a network’s `services` object is unavailable for that network.

## Resolution and release checks

The release uses the catalog and resolver from its archived clean Git commit.
Resolution runs in an offline Python container. Its only source mounts are the
JSON catalog and resolver; API-key bytes arrive through stdin. It checks the
selected chain against the deployment's explicit expected chain ID and writes
the resolved URL with mode `0600` into a dedicated directory within the private
ceremony directory. Existing RPC proxies read that file; ceremony cleanup
removes it. Logs identify the selection without printing the URL or API key.

Before broadcasting, deployment scripts also check the live chain ID against
the expected ID. Catalog selection and custom URLs go through the same live
chain checks.

Proxy restrictions still apply: HTTPS on port 443, public IP addresses, no URL
userinfo, and no custom authorization headers. Use a general-purpose execution
RPC supporting reads, fee queries, gas estimation, signed-transaction submission
and receipt lookup. Write-only sequencer endpoints and beacon APIs cannot serve
the complete workflow. Later verification needs contract state at the deployment
block, so check the provider's historical-state retention.

The catalog is not a deployment certification. Shared endpoints can restrict
methods or traffic; plans and availability can change. Provider fees are separate
from blockchain transaction fees. The local rehearsal keeps its own private
Anvil endpoint and ignores external catalog settings.

## Sources and maintenance

Endpoint documentation was checked on **2026-10-20**, not live-tested against
these services. Update the catalog row when a published endpoint changes; a new
network using the existing services needs no resolver code change.

- [PublicNode Ethereum](https://ethereum.publicnode.com/) and
  [Base](https://base.publicnode.com/) supply the catalog's public Ethereum/Base endpoints.
- [Arbitrum network information](https://docs.arbitrum.io/chain-info),
  [OP network information](https://docs.optimism.io/op-mainnet/network-information/connecting-to-op)
  and [Polygon RPC information](https://docs.polygon.technology/pos/reference/rpc-endpoints)
  supply their public endpoints and network IDs.
- [Base network information](https://docs.base.org/get-started/connect-to-base)
  supplies Base's network IDs.
- [Alchemy's supported networks](https://www.alchemy.com/docs/reference/node-supported-chains)
  supplies the authenticated URL templates.
- [Quicknode's network and retention guide](https://www.quicknode.com/docs/platform/supported-chains-node-types)
  covers account-specific endpoints usable through `RPC_URL_FILE`.
