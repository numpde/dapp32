# Select an RPC service

The deploy and verify commands for Bike NFT, Escrow and Pay-to-Play can select
an endpoint from the repository's [RPC catalog](../tools/rpc-catalog.json).
List the exact network names, chain IDs and service URL templates with:

```sh
make release/rpc/list
```

The [network reference table](evm-networks.html) shows mainnets and their
application testnets with fixed indexes, chain IDs, gas tokens, explorers,
RPC services, and authoritative references. Switch between mainnets and
testnets without changing row indexes or links. It reads the same catalog as
the release commands; it does not maintain another network list.

Open the HTML through an HTTP server rooted at this repository, or open it
directly from disk and choose `tools/rpc-catalog.json` when prompted. No file
is uploaded and the page does not contact any RPC service.

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

## Run a proxy for contract indexing

The [indexing lane](../compose/rpc-indexer.yml) runs the repository's RPC proxy
as a persistent service. It starts only the proxy; the indexer, its contract
configuration and its database remain separate services. The proxy keeps the
provider URL and any API key away from the indexer and exposes only:

```text
eth_chainId eth_blockNumber eth_getBlockByNumber eth_getLogs
```

This covers ordinary contract event indexing and block/reorg tracking. It does
not grant transaction submission. Enrichment through `eth_call`, receipts or
traces needs an explicit change to this lane's allowlist after choosing that
feature. The Cast and release lanes keep their own method policies.

Run as a non-root user with Docker and Compose. Prepare an existing file
outside this checkout containing one complete HTTPS RPC URL. It must have a
normalized absolute path, no symlink components, be owned by your `LOCAL_UID`,
and have owner-only permissions, for example `0600`. Do not put the URL or API
key in a Make argument or an indexer configuration.

```sh
export RPC_URL_FILE=/absolute/path/to/private/base-sepolia-rpc-url
export RPC_INDEXER_COMPOSE_PROJECT_NAME=contract-base-sepolia
make rpc/indexer/up
make rpc/indexer/logs
```

The proxy runs as the operator's non-root UID, with a read-only root filesystem,
no capabilities, a read-only URL-file bind, bounded memory/PIDs/CPU and no host
port. Only the proxy joins its egress network. The command prints the client
network and the internal RPC URL; the example above produces:

```text
Client network: contract-base-sepolia_rpc_internal
RPC URL: http://contract-base-sepolia-rpc:8080
```

`/healthz` checks local request handling, not the upstream provider's availability
or chain ID. Verify the chain ID in the indexer configuration and at startup.
Use a different project name and URL file for each chain or provider policy.
The catalog records Ethereum mainnet/Sepolia, Base mainnet/Sepolia and Avalanche
C-Chain mainnet/Fuji independently. Project-specific DNS aliases let one indexer
join several proxy networks without confusing their endpoints.

### Attach an indexer without granting internet access

In the indexer's own Compose file, join the proxy's existing internal network.
This is a networking fragment to apply to an explicitly configured, pinned
indexer image; it is not a complete rindexer deployment:

```yaml
services:
  rindexer:
    networks:
      - base_sepolia_rpc
      - indexer_database
  postgres:
    networks:
      - indexer_database

networks:
  base_sepolia_rpc:
    external: true
    name: contract-base-sepolia_rpc_internal
  indexer_database:
    internal: true
```

List only these internal networks on the indexer, and do not attach it to a
default or egress network. Do not use `network_mode: service:rpc-proxy`: that
would share the proxy's network namespace and its internet route. Give the
indexer its own database role and database. Do not mount the RPC URL file or
any wallet/signing key into it. The proxy itself needs no database access.

For rindexer, point the network's `rpc` at the internal URL. For a few selected
contracts, turn off the shared, unfiltered live-tip log fetch. Set an initial
block span that the chosen provider accepts, then adjust using real response
sizes and latency:

```yaml
networks:
  - name: base_sepolia
    chain_id: 84532
    rpc: http://contract-base-sepolia-rpc:8080
    max_block_range: 1000
    block_poll_frequency: optimized
    shared_tip_logs:
      enabled: false
```

This fragment still needs the project's storage, ABIs, contract addresses,
start blocks and events. Keep address filtering in the RPC requests; avoid
rindexer's `in-memory` address filtering for this use case. The proxy enforces
methods and resource limits; it does not restrict contract addresses or prove
that an upstream response is correct. Do not enable HyperSync, webhook or other
external-service integrations on this isolated client without designing a
separate permitted route. These rindexer settings are documented in its
[network configuration](https://rindexer.xyz/docs/start-building/yaml-config/networks/).

### Capacity, deadlines and failure handling

The indexing profile sets the following limits explicitly. Other lanes use
smaller time budgets; none silently inherits a permissive policy.

| Setting | Indexing profile | Meaning |
| --- | --- | --- |
| `RPC_PROXY_MAX_CONCURRENT_REQUESTS` | 4 | Maximum active client connections, including slow clients and health checks |
| `RPC_PROXY_MAX_BATCH_ITEMS` | 100 | Maximum JSON-RPC items in one batch; every item must be allowed |
| `RPC_PROXY_MAX_REQUEST_BYTES` | 1 MiB | Maximum request body |
| `RPC_PROXY_MAX_RESPONSE_BYTES` | 16 MiB | Maximum upstream response body |
| `RPC_PROXY_CONNECT_TIMEOUT_SECONDS` | 10 seconds | Socket inactivity/connect timeout |
| `RPC_PROXY_UPSTREAM_TIMEOUT_SECONDS` | 60 seconds | Total upstream DNS/TLS/request/response budget |
| `RPC_PROXY_REQUEST_TIMEOUT_SECONDS` | 90 seconds | Whole accepted connection budget, including client headers/body and response delivery |

The whole-connection deadline remains the outer cap. Concurrent requests run
in separate bounded worker processes, so a stalled request does not serialize
the others. When all workers are occupied, new connections receive HTTP `503`
with `Retry-After`; there is no unbounded application queue. A health probe may
also receive `503` while all workers are busy.

Start with low indexer concurrency and allow room for its block polling and
health probes. Concurrency across multiple event streams adds up. These limits
bound simultaneous work, not requests per second or a provider's daily quota.
If you encounter `503`, reduce combined client concurrency. If log responses
hit the size cap or deadlines, reduce the requested block range first. Provider
rate limits still apply, including to batches, and historical coverage depends
on the selected endpoint. Read-only callers may retry with bounded backoff;
the proxy itself never retries, caches or switches upstreams. Existing release
lanes preserve the explicit unknown-outcome error when a transaction submission
might have reached the provider.

Review limits together with container memory and PID budgets before increasing
them. Change the explicit lane configuration for the intended workload rather
than widening other clients' policies. WebSocket subscriptions and arbitrary
HTTP proxying are not supported by this lane. Ordinary HTTP log polling works
through it.

Logs omit request bodies and credential-bearing URLs. The indexing service
keeps at most three 10 MiB local log files. Stop indexer clients before removing
their proxy network:

```sh
make rpc/indexer/down RPC_INDEXER_COMPOSE_PROJECT_NAME=contract-base-sepolia
```

Logs and shutdown do not require the original URL file. To rotate its contents,
stop the proxy, replace the protected file, and run `rpc/indexer/up` again so the
bind mount refers to the current file. Keep it available for the proxy's lifetime.

## Sources and maintenance

Endpoint documentation was checked on **2026-10-20**, not live-tested against
these services. Update the catalog row when a published endpoint changes; a new
network using the existing services needs no resolver code change.

Keep existing catalog keys and mainnet `index` values stable. Mainnet rows own
their index; each testnet's `mainnet` field names its mainnet's catalog key.
The table currently expects one application testnet per mainnet. Add or change
network names, gas symbols, explorers, source URLs and source-check dates in
the catalog. `references` cite network owners and endpoint providers;
`checkedOn` records the documentation check date. A `retired` entry keeps its
identity and an explanatory `note`, with an empty `services` object so release
commands cannot resolve an endpoint for it.

The BSC testnet public endpoint uses HTTPS port 8545. It can be used by wallets,
but does not meet the release proxy's port-443 restriction described above.
Scroll Sepolia is retained as retired, following Scroll's shutdown notice;
its former RPC is deliberately absent.

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
