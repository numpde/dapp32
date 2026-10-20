# RPC services by chain

Choose a network first, then an RPC service for that network. The release
commands take one HTTPS URL through `RPC_URL_FILE`; they do not select a provider
from this catalog.

Sources checked on **2026-10-20**. These are documented endpoints and service
options, not live-tested deployment recommendations. Chain availability, method
restrictions, quotas and prices can change. Listing a chain here does not prove
that every app has been tested on it.

## Shared endpoints without an API key

These are starting points for development and read-only checks. They have shared
capacity; check the operator's current limits before relying on them for a release.
“No API key” does not mean unlimited requests.

| Network | Chain ID | Gas asset | Operator | HTTPS RPC URL | Source |
| --- | ---: | --- | --- | --- | --- |
| Ethereum mainnet | 1 | ETH | PublicNode / Allnodes | `https://ethereum-rpc.publicnode.com` | [PublicNode](https://ethereum.publicnode.com/) |
| Ethereum Sepolia | 11155111 | Test ETH | PublicNode / Allnodes | `https://ethereum-sepolia-rpc.publicnode.com` | [PublicNode Sepolia](https://ethereum.publicnode.com/?sepolia) |
| Base mainnet | 8453 | ETH | Base | `https://mainnet.base.org` | [Base networks](https://docs.base.org/get-started/connect-to-base) |
| Base Sepolia | 84532 | Test ETH | Base | `https://sepolia.base.org` | [Base networks](https://docs.base.org/get-started/connect-to-base) |
| Arbitrum One | 42161 | ETH | Arbitrum public RPC | `https://arb1.arbitrum.io/rpc` | [Arbitrum networks](https://docs.arbitrum.io/chain-info) |
| Arbitrum Sepolia | 421614 | Test ETH | Arbitrum public RPC | `https://sepolia-rollup.arbitrum.io/rpc` | [Arbitrum networks](https://docs.arbitrum.io/chain-info) |
| OP Mainnet | 10 | ETH | Optimism public RPC | `https://mainnet.optimism.io` | [OP networks](https://docs.optimism.io/op-mainnet/network-information/connecting-to-op) |
| OP Sepolia | 11155420 | Test ETH | Optimism public RPC | `https://sepolia.optimism.io` | [OP networks](https://docs.optimism.io/op-mainnet/network-information/connecting-to-op) |
| Polygon PoS mainnet | 137 | POL | dRPC | `https://polygon.drpc.org` | [Polygon networks](https://docs.polygon.technology/pos/reference/rpc-endpoints) |
| Polygon Amoy | 80002 | Test POL | dRPC | `https://polygon-amoy.drpc.org` | [Polygon networks](https://docs.polygon.technology/pos/reference/rpc-endpoints) |

Ethereum's application-development testnet is Sepolia; Hoodi is for validator
and staking tests. See [Ethereum's network guide](https://ethereum.org/developers/docs/networks/).
Sepolia, Base Sepolia, Arbitrum Sepolia and OP Sepolia are separate chains:
their balances and deployments are separate too.

## Services with account-specific endpoints

Both services below list all ten networks above. Create an endpoint for the
exact network in the provider's dashboard. Check the current plan's quotas,
method support and historical-state retention; an account-specific URL alone
does not guarantee dedicated infrastructure or an uptime commitment.

| Service | How to obtain the URL | Network and access documentation |
| --- | --- | --- |
| Alchemy | Create an account and app; enable the chosen network and copy its HTTPS URL containing your API key. | [Supported networks and URL templates](https://www.alchemy.com/docs/reference/node-supported-chains) |
| Quicknode | Create an account and endpoint for the chosen chain/network; copy the generated HTTPS URL. | [Supported networks and retention](https://www.quicknode.com/docs/platform/supported-chains-node-types) |

Alchemy's documented URL shape is `https://<network>.g.alchemy.com/v2/<API_KEY>`.
Replace both placeholders; these network names select different chains:

| Chain family | Mainnet `<network>` | Testnet `<network>` |
| --- | --- | --- |
| Ethereum | `eth-mainnet` | `eth-sepolia` |
| Base | `base-mainnet` | `base-sepolia` |
| Arbitrum | `arb-mainnet` | `arb-sepolia` |
| Optimism | `opt-mainnet` | `opt-sepolia` |
| Polygon PoS | `polygon-mainnet` | `polygon-amoy` |

Use the URL issued by the dashboard, rather than constructing a Quicknode URL
from a guessed hostname. Provider subscription charges are separate from the
chain's transaction fees.

## What this repository's release workflow needs

The endpoint must support ordinary EVM JSON-RPC reads, fee queries, gas
estimation, `eth_sendRawTransaction`, and transaction/receipt lookup. Verification
also reads contract code and state at the deployment block; the provider must
retain that historical state for as long as you need to verify the artifact.
The exact method gates live in [deployment Compose](../compose/release/deploy.yml)
and [verification Compose](../compose/release/verify.yml).

Use a general-purpose execution RPC endpoint. A beacon API or write-only
sequencer endpoint cannot serve the complete workflow. In particular, Base's
documentation separates RPC and transaction-submission URLs. This catalog has
not established that the listed public Base URLs support the complete release;
choose an account-specific endpoint whose provider documents both reads and
sends. Arbitrum and Optimism also document separate write-only sequencer URLs.

The current proxy accepts HTTPS on port 443 with publicly routable addresses.
It supports credentials in the URL path/query, but rejects URL userinfo and
does not accept custom authorization headers. A service requiring header-only
authentication cannot be used directly with this workflow.

Save the selected URL in an owner-only regular file outside the repository,
then pass its absolute path as `RPC_URL_FILE`. Do not put a URL containing an API
key into a committed example or a command-line argument. File creation and
permission requirements are in the [release ceremony](release-ceremony.md).

For a read-only connectivity check:

```sh
make cast/live/block-number/read RPC_URL_FILE=/absolute/path/to/rpc-url
```

A successful block-number request proves connectivity, not full deployment
compatibility. The release workflow separately compares the reported chain ID
with your expected chain ID. It signs transactions locally; the RPC provider
receives signed transactions, not the deployer's private key.

For a local workflow test without choosing an external service, use
`make release/local/rehearsal/run DAPP=pay-to-play`. Its private Anvil RPC is
created and removed by the rehearsal; it is not a persistent endpoint to copy
into a testnet release.
