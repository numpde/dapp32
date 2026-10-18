# Bounded PayToPlay refunds

This operator tool discovers customers from `Funded` and incoming `Moved` events,
reads their current recovery state, and optionally submits individual `refund`
transactions. It neither closes channels nor collects vouchers, chooses refund
recipients, signs purchase vouchers, deploys contracts, or changes chain time.

The normal run is a **read-only plan**. Execution requires a separate Compose
overlay, an explicit confirmation, a file-backed relayer key, a protected state
directory, and a configuration that pins the chain, contract, runtime-code hash,
channel, scan interval, confirmations, gas, fees and transaction count.

## Docker entrypoints

Run from the repository root after the normal explicit dependency installation:

```sh
make -f tools/pay-to-play-refunds.mk help
make -f tools/pay-to-play-refunds.mk pay-to-play/refunds/check
make -f tools/pay-to-play-refunds.mk pay-to-play/local/recovery/run
```

The supplemental Makefile includes the root Makefile and reuses its non-root,
source-path and dependency guards. Keep the `-f` argument: these additional
operator targets are not declared by the root Makefile alone. The recovery
scenario runs the existing disposable scenario first and then the recovery CAM
scenario, using the same isolated deployment and cleanup. It does not contact
an operator deployment. The offline `check` target typechecks the entire worker
and runs its tests. Worker tests are also included in the JS workspace suite.

## Configuration

Create a JSON file outside the repository, owned by the executing user, mode
0600. All fields are required, and unknown fields are rejected. For example:

```json
{
  "chainId": "<positive deployment chain ID>",
  "payment": "<PayToPlay address, not the CAM host>",
  "codeHash": "<0x-prefixed keccak256 of verified deployed runtime bytecode>",
  "channelId": "1",
  "fromBlock": "<first block in this discovery slice>",
  "toBlock": "<last confirmed block in this discovery slice>",
  "confirmations": 12,
  "blockChunk": 1000,
  "maxCustomers": 500,
  "maxTransactions": 10,
  "gasLimit": "300000",
  "maxFeePerGas": "20000000000",
  "maxPriorityFeePerGas": "1000000000"
}
```

Replace every placeholder; they intentionally fail validation. Chain and uint256
quantities use canonical unsigned decimal strings. Counts use JSON integers.
Fees are wei per gas. The example fees, gas limit and confirmation count are
not chain-specific recommendations: review them for the selected deployment.
The runtime hash must come from your verified deployment, including its actual
constructor-dependent runtime bytes, not a guessed contract address or an
unverified server's assertion. The tool also checks the 365-day horizon and
30-day maximum claim-period getters and resolves the selected channel.

The inclusive scan interval is limited to 100,000 blocks, each log page to
10,000 blocks and 10,000 decoded events, unique customers to 1,000, and newly
submitted transactions to 100 per invocation. Smaller configured bounds apply.
RPC responses are limited to 2 MiB with 10-second HTTP timeouts and no redirects
or automatic HTTP retries. If a discovery bound is exceeded, the run fails
before signing instead of silently dropping customers. Narrow the interval or
reduce `blockChunk` and repeat.

`toBlock` must have the requested confirmations; its hash is checked again after
discovery and before each submission. Current position state is read afresh,
and the onchain contract enforces the deadline when each transaction executes.
Do not treat a plan as a reservation: the owner can update a recipient, another
caller can refund, or a chain reorganization can change an observed state.

**Discover the complete funding history when draining a channel.** A position
funded long ago may still hold money. Scan historical slices covering the whole
period from deployment through closure, including incoming moves. This tool is
a bounded one-shot worker, not a persistent event indexer. It does not silently
advance a discovery cursor past failed or not-yet-due positions. Repeat the
same slices after deadlines or failures. Successful old refunds are not a
permanent blacklist: an open channel may have a later funding cycle for the
same customer. A closed channel's `escrowTotal == 0` is the completion criterion
for its accounted balances, not merely a successful scan of one interval.

## Read-only plan

Put the RPC URL in a separate owner-only 0600 file. Do not put RPC credentials
in command-line values. Supply absolute, non-symlink file paths:

```sh
make -f tools/pay-to-play-refunds.mk pay-to-play/refunds/plan \
  REFUND_CONFIG_FILE=/secure/refunds/config.json \
  RPC_URL_FILE=/secure/refunds/rpc-url
```

The plan does not mount or open a signing key or a state directory. It reports
discovery scope, due positions, current destinations and balances, the
configured execution-gas budget, a batch summary and the live channel total.
An empty expired funding cycle is still due for a zero refund before reuse;
a clean, already-refunded position in a retired channel is skipped.

## Execute

Use a **dedicated gas-paying relayer account**, not a customer voucher key or
admin account. Restrict other activity on that signing account while the worker
runs. One worker process/state directory owns its nonce stream; do not run the
same relayer concurrently from another state directory or for another channel.
The pending-nonce check detects an already-visible outside transaction, but is
not a lock against a different signer racing after that check.

Pre-create an empty state directory outside the repository, owned by `LOCAL_UID`
and mode 0700. The private-key file must be owned by the same user and mode 0600,
contain one 0x-prefixed 32-byte private key, and be mounted read-only. Never
commit these files, logs containing credentials, or signed transaction bytes.

```sh
make -f tools/pay-to-play-refunds.mk pay-to-play/refunds/run \
  REFUND_CONFIG_FILE=/secure/refunds/config.json \
  RPC_URL_FILE=/secure/refunds/rpc-url \
  REFUND_PRIVATE_KEY_FILE=/secure/refunds/relayer-key \
  REFUND_STATE_DIR=/secure/refunds/state \
  CONFIRM_PAY_TO_PLAY_REFUNDS=YES
```

Every transaction has zero native value and calls only `refund(customer,
channelId)` on the pinned contract. The recipient is resolved by the contract;
the executor has no recipient argument. Simulations use the configured gas
limit. A simulation failure is isolated and consumes no transaction grant.
A mined revert consumes one grant; later customers still run. The maximum
execution-gas charge for new transactions in a run is
`maxTransactions * gasLimit * maxFeePerGas`. This is not a bound on rollup L1
fees, nor on a transaction already pending from a previous invocation. The tool
uses EIP-1559 transactions; legacy-only networks need a separate policy.

## Crash, retry and pending transactions

Before broadcasting, the worker signs locally, calculates the exact transaction
hash, and durably writes its customer, hash and nonce to `refunds.json`. It
never saves the raw signed bytes or key. State writes use a temporary file,
fsync, rename and directory fsync. A directory lock prevents concurrent runs
using the same state directory. The state identity includes chain, payment
address, runtime hash and channel, so accidental reuse for another deployment
fails closed.

A matching receipt with the configured confirmations clears the pending entry
and records the last receipt's status, block number and block hash. Structured
JSON lines on stdout provide the full per-run audit stream; retain those lines
outside the repository when an operation history is needed. The bounded state
file stores only the pending transaction and last confirmed/reverted receipt,
not an indefinitely growing list of customers or results.

If broadcast or receipt delivery is uncertain, the batch stops and leaves the
pending hash. A later invocation reconciles that hash before signing anything
else. A timeout is not proof of rejection. The worker does not silently replace,
rebroadcast, cancel, or skip an unknown transaction, and does not adopt a
replacement transaction's receipt. One pending worker transaction does not
prevent another independent authorized caller from refunding positions.

A process crash can leave `refunds.lock`. Remove that lock **only after checking
that the old process is no longer running**; retain `refunds.json`. Inspect any
pending hash and signer nonce with the node before intervention. A crash after
the journal write but before broadcast can leave a hash the node has never
seen. The tool deliberately requires operator reconciliation rather than
assuming it is safe to sign again. Do not delete a pending journal merely
because the receipt timed out. Preserve its evidence and resolve the transaction
or establish that it cannot execute before initializing replacement state.

Receipt confirmations are a policy, not protection against arbitrarily deep
reorganizations. Review reorgs beyond that depth and rescan relevant intervals.

Exit codes: 0 for a completed plan/batch; 2 for isolated failures, deferred due
positions, or a pending transaction; 1 for configuration, identity, discovery,
journal or other fatal errors. Error messages report only the owned execution
phase, not raw SDK errors that may embed RPC credentials or signed calldata.

## Validation boundary

The dependency-free core/config/journal tests exercise pagination, bounds,
recipient failure isolation, retry semantics, transaction caps, uncertain
broadcasts, file protections and journal restart. The local recovery scenario
executes CAM recovery calls, verifies discovery of incoming-move-only customers,
and runs the actual file-backed CLI against the disposable deployment. It checks
a read-only plan, a one-transaction execution cap, a resumed batch, an empty
rerun, and a confirmed journal entry. These fixture checks do not verify an
operator deployment or justify skipping a pinned dry run before a live batch.
