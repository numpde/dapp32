# Pay-to-Play

Deposit native coins, register a permanent voucher-signing key, and authorize
invoice-referenced cumulative payments offchain. Recover unused coins through an
ordinary delayed withdrawal or the full-recovery lifecycle. Retire a channel
without looping over customers or giving an operator authority to take deposits.

[Payments](#from-deposit-to-payment) · [Keys](#register-a-permanent-voucher-key) ·
[Invoices](#invoice-references-and-service-accounting) ·
[Withdrawals](#recover-or-move-funds-after-a-request) ·
[Recovery and retirement](#full-recovery-and-channel-retirement) ·
[Integration](#integration-reference) · [Local demo](#run-the-disposable-local-demo)

The repository implements settlement and a generic CAM interface, not a service
that sells API access, provisions work, tracks purchase credit or issues delivery
refunds. Those responsibilities remain with the integrating P2P service.

This interface requires a replacement deployment. It does not upgrade an existing
contract. The voucher fields, domain name/version and `VoucherCollected` event
remain unchanged; a new deployment address changes the EIP-712 verifying contract,
so signatures for the old deployment do not authorize payments on the replacement.
Clients must update the `createChannel` and `collect` calls and decode the added
`collector` field in both `Channel` and `PositionView` (after `payee` and `admin`,
respectively). The constructor and the `ChannelCreated` and `VoucherCollected`
event schemas stay unchanged. Creation also emits `CollectorChanged`, so select
receipt events by their topic rather than assuming one payment-contract log.

## From deposit to payment

Suppose Alice buys work from Bob's service. The admin creates channel 7 with
Bob's payment address, a collector address, and a fixed claim period. Example
amounts below are wei, not whole native coins; transaction fees are separate.

Alice deposits 100 into her channel-7 position and registers signing key K.
K signs a voucher with `customer = Alice`, `channelId = 7`,
`cumulativeTotal = 30`, and `invoiceHash` committing to the invoice for that
purchase. Bob verifies the invoice, registered key, signature and available
backing before deciding to deliver work. The configured collector submits the
voucher with a payment limit of 30. The contract pays Bob 30, leaves Alice's
balance at 70, and records 30 as actually paid. A later voucher for cumulative total 50 with another invoice hash can pay
another 20, not another 50.

Funding alone authorizes no charge. A voucher authorizes payment; it does not
prove delivery. Uncollected vouchers and service obligations are offchain facts
that the service must retain and reconcile durably. The contract authenticates
the invoice reference but does not read the invoice or allocate payment to it.

## A channel is shared; each account's balance is separate

A channel defines one current payment recipient, one current collector, and a
fixed claim period. The payee must be nonzero; a zero collector pauses voucher
collection for that channel.
The claim period is the wait for an ordinary withdrawal and the final window
for voucher collection during wind-down; it is not a voucher expiry field.
Each `(customer, channelId)` has a separate position: balance, lifetime amount
actually paid, permanent voucher key, optional ordinary withdrawal request,
funding-cycle deadline and optional full-refund recipient. Channels are not
individual customer wallets. Alice's balances in channels 7 and 8 are separate,
as are Alice's and Bob's balances in channel 7. The contract holds the coins;
the balance belongs to the recorded customer address, not to the channel payee
or the wallet currently viewing it. A wallet is how an account authorizes calls.

For direct merchant settlement, each merchant uses a channel whose payee is its
receiving wallet. Collected earnings arrive in that external wallet, not in an
in-contract spending position. Spending those earnings through another channel
requires a separate deposit. There is no automatic onward credit or single
shared spending balance. The admin's existing payee-redirection authority is
unchanged; an invoice naming a merchant does not remove that trust assumption.

| Identity | Authority |
| --- | --- |
| Balance owner (`customer`) | Funds its position, registers its key, requests withdrawals, moves funds, renews, closes its funding cycle, and chooses its full-refund recipient. |
| Permanent voucher key | Signs cumulative payment authority and its invoice reference for that position; has no separate withdrawal, refund-destination or administrative authority. |
| Channel collector | Only this address may submit voucher payments for its channel. The admin can change it or set it to zero to pause collection. |
| Channel payee | Receives collected payments and may start position wind-down or permanent channel retirement. |
| Contract admin | Creates channels, changes payees and collectors, and may start wind-down/retirement; cannot sign customer vouchers or select customer refund destinations. |
| Relayer | May complete an authorized mature withdrawal or execute a due full refund. Voucher collection requires the configured channel collector. Receives no right to choose the destination. |

The selected account in the viewer determines displayed actions but does not
prove signing authority. Before a wallet connects, that account comes from the
link. Before sending, the connected wallet must match the
acting account used for review. Viewing another customer's balance never grants
control over that balance. Connecting or switching a wallet selects its active
account; it does not change the owner of an already-opened balance.

## Use the app

Choose the balance owner and existing channel ID, then **Open balance**. This is
a read. The opened owner/channel remain fixed across wallet changes. For
example, opening Alice's position and connecting Bob's wallet does not turn it
into Bob's balance. Owner-only controls become unavailable, while permitted
relayer or channel-operator controls remain available.

Enter the inputs and choose the action. Its **Review transaction** subtext means
it prepares and simulates a transaction. Inspect the contract, function,
arguments and native value, then choose **Send with wallet** to request signing
and submission.
Rely on a successful receipt, not a simulation or transaction hash. A state can
change between review and execution. Amount inputs link whole wei and decimal
native coins; one native coin is 10^18 wei. Fees are separate.

**Refresh** rereads the latest chain state and action availability, retains
compatible drafts, and discards a prepared transaction. It does not mine a
block, advance chain time, reload publication resources or execute a refund.
**Back** rereads a prior view and restores compatible drafts when session
history exists. Reloading or changing the connected account clears drafts.

For collection, connect the configured collector and enter the signed cumulative
total, exact 32-byte invoice hash, signature, and the maximum payment for this
transaction. The maximum is separate from the signed voucher. Signing details
display that same reference and its EIP-712 digest. This generic form does not fetch, validate or approve invoice
contents; the external signing client must verify and display the invoice,
merchant, settlement context and cumulative increase before authorization.

Open **Manage recovery and channel closure** for the recovery screen. It keeps
the same owner/channel pinned and displays the phase, effective deadlines,
refund destination and entire channel's escrow total. Phase 0 is operating,
1 is settling, and 2 is refund-only. Displayed dates use chain timestamps; a
relative display uses the device clock for presentation only.

## Register a permanent voucher key

Connect the balance-owner wallet, enter the **address** of an ECDSA key you
control, and choose **Register permanent voucher key**. Never enter a private
key. Registration is once per nonzero-channel position; zero and subsequent
registrations are rejected, even when proposing the same key. No funding is
required. Verify signing access before choosing: the contract does not prove
that you possess the selected private key.

The key cannot be replaced, revoked or reset, including after a full refund.
Changing who controls the balance-owner account, its wallet software or its
delegations does not revoke K or invalidate its ECDSA signatures.
Collection never consults the customer's or key address's
ERC-1271 policy, and neither address is required to remain code-free. A smart
wallet can own the deposit and register an external ECDSA key.

If K is lost or compromised, the owner retains ordinary recovery authority but
cannot invalidate already-authorized claims. Stop funding an unsafe position;
use a different customer/channel position for a different key. Emptying and
refunding a position do not change its key or lifetime paid amount.

## A voucher authorizes a cumulative total, not a new charge

Before the applicable collection deadline:

```text
payment = min(maxAmount, max(authorized total - lifetime actually paid, 0), current balance)
```

Only the channel’s configured nonzero collector can submit collection. The admin
sets the collector when creating the channel and can rotate it later. The
contract checks the immediate caller; a collector contract controls who can
trigger its own calls. Zero pauses that channel’s collection without blocking withdrawals or refunds.
`maxAmount` is an unsigned per-transaction limit, not a new voucher field or a
lifetime limit: repeated authorized calls can collect the unpaid remainder.
A registered key and valid canonical ECDSA signature are required even for a
zero payment or a zero limit. Only successful voucher transfers increase
`voucherPaid`.

A position starting with `voucherPaid = 0` and a voucher for 100 can collect 30
from a balance of 30, then another 20 after a
20 deposit, leaving 50 of authorization outstanding. Reusing the same voucher
cannot exceed its unpaid total. A higher voucher does not invalidate lower
ones whose totals still exceed actual payments. Funding, movement, withdrawals
and full refunds never reset `voucherPaid`.

There is no per-voucher expiry field. **The lifecycle does impose a collection
cutoff:** collection is forbidden at or after the effective refund deadline.
After a full refund in an open channel, later funding starts a new operating
cycle, and old unpaid vouchers can collect again against it. A permanently
retired channel never accepts funding or resumes collection.

Vouchers bind customer, channel, total, invoice hash, chain ID and payment-contract
address, not the channel's current payee. The admin can redirect unpaid voucher
capacity by changing the payee, including claims against later backing. That
trust remains explicit. Payee changes are allowed during channel settlement,
but not after its final closure deadline, and never change any recovery deadline.

## Invoice references and service accounting

`invoiceHash` is an opaque commitment in the signed voucher. Changing only that
hash without resigning invalidates the signature, even when payment would be
zero. The contract stores no invoice hash, allocation or consumption flag and
checks no invoice uniqueness, acceptance expiry or fulfillment. It accepts any
bytes32 value, including zero; this does not establish that a real invoice exists.

One collection can settle several invoices partially or fully. Suppose invoice
A assigns the cumulative interval 0 -> 30 and invoice B assigns 30 -> 70. With
nothing paid yet and a balance of 50, submitting B's voucher collects 50 and
emits B's hash. Allocating in authorization order would pay 30 toward A and 20
toward B. **The event does not say that B alone received 50 or was fully paid.**
Refilling by 20 lets the same B voucher collect the remainder. Different invoice
hashes at the same cumulative total do not create independent entitlements.

The [invoice/voucher helper guide](../../js/tools/pay-to-play-vouchers/README.md)
defines a versioned, deterministic invoice encoding, SHA-256 commitment and
interoperability vector. Its immutable invoice includes purchase identity,
merchant, customer, settlement context, cumulative interval, acceptance deadline
and terms commitment. Mutable fulfillment, cancellation and refund status live
outside that document. A later voucher does not commit to the complete history
of earlier invoices; retain their documents and authorizations separately.

P2P must durably reserve disjoint cumulative intervals per settlement position.
Concurrent purchases cannot both reuse the same starting total. A retry recovers
the original purchase, invoice and voucher rather than allocating another
increase. The helper validates documents and caller-supplied acceptance context;
it is not a database-backed acceptance service, invoice-issuer authentication,
backing reservation or fulfillment system.

**Invoice acceptance expiry does not revoke an issued voucher.** Commercial
cancellation, rejection, delivery failure or a refund does not reduce onchain
`voucherPaid`, rewind the service's authorization stream, or erase a disclosed
signature. Preserve outstanding signed exposure even when the invoice was not
commercially accepted. Recovering collateral likewise does not extinguish unpaid
authority against later funding in an open channel. Keep commercial amounts due
and potential signed payment authority as distinct service facts.

## Recover or move funds after a request

While operating, the balance owner can request a positive amount not exceeding
the current balance. `requestWithdrawal` is a no-op while a request already
exists, without validating a replacement amount. `setWithdrawal` explicitly
creates/replaces a valid request and restarts the entire claim period, including
for the same or a smaller amount. There is no cancellation operation.

At `timestamp >= readyAt`, anyone can execute `withdraw(customer, channelId)`,
which pays the customer. Only the owner can instead call `move(source, target)`
to credit another of its own positions. The target must be operating. Both
transfer `min(requestedAmount, balance)` and clear the whole request, including
a zero or partial transfer. Failed native payments revert all effects.

A request does not reserve money. Voucher collection uses actual balance, not
`effectiveBalance = max(balance - requestedAmount, 0)`. Collection and top-ups
do not alter request amount or readiness. Fresh funds can therefore fall under
a previously mature, unconsumed request. Once that request is consumed, later
funding requires a fresh request and wait for another ordinary withdrawal.

**Wind-down preserves already-created withdrawal entitlements.** It disallows
new/replacement requests during settlement, but does not postpone an existing
one. A full refund clears it. Ordinary withdrawals always pay the owner, even
when a different full-refund recipient has been configured. Because withdrawal
is permissionless, another caller can execute it before an owner's intended
internal move and consume their common request.

Moving changes internal balances, not the contract's native-coin balance. The
recovery baselines before the invoice-v2 change were 104,390 execution gas into
a previously unfunded channel and 53,349 into a funded channel. The regression
ceilings remain 130,000 and 67,000 respectively. Rerun them for the current build.
These are callee execution figures before refunds, not transaction fee quotes.

## Full recovery and channel retirement

Let H be 365 days and G the channel's fixed claim period (between zero and
30 days). Here `now` means the timestamp of the block executing the transaction.
Positive funding initializes or renews a position's deadline to
`now + H + G`, without shortening a later deadline. Positive incoming moves and
explicit owner renewal do the same while operating. Zero deposits, collection,
relayer calls, key registration and recipient changes do not renew it.

| Phase | Boundary and effects |
| --- | --- |
| Operating | Until effective `refundAt - G`. Funding and owner renewal are permitted. |
| Settling | From `refundAt - G` through strictly before `refundAt`. No funding, incoming moves, renewal or key registration. Valid vouchers remain collectible. |
| Refund-only | At or after `refundAt`. Voucher collection is prohibited; anyone may refund the entire remaining balance. |

A position with no funding cycle in an open channel has no annual deadline.
The first positive funding starts it. With G = seven days, annual settlement
begins on day 365 and full refund becomes available on day 372. No initiating
transaction is needed for these phase transitions, but a refund transaction
must still be submitted. No process runs automatically when time passes.
With a zero claim period, the settling window has zero duration.

### Early wind-down

The balance owner, contract admin or current channel payee may call
`closePosition(customer, channelId)` at any time for a scheduled funding cycle.
It shortens the deadline to `now + G` only when that is earlier than the current
effective deadline. An unscheduled position is a no-op. Repeated calls cannot
restart settlement or postpone recovery. Settlement cannot be cancelled or
renewed. Closure introduces no immediate admin/payee sweep.

### Retire a channel

The admin or current payee may call `closeChannel(channelId)` once. It records
`closeAt = now + G` and immediately prevents new funding, renewal and key
registration throughout the channel. For every position, the effective refund
deadline is the earlier nonzero value of its own deadline and `closeAt`.
Existing earlier exits are preserved. Repeated closure does not change the date.

The channel never reopens; its ID is never reused. The operation does not loop
over customers, send coins, or depend on a receiver accepting payment. After
the applicable deadline, each balance can be refunded independently. An admin
can change a broken payee during settlement, but cannot extend the deadline.

Channel 0 has no payee, collector or voucher keys and cannot collect vouchers. It follows
the same annual recovery and ordinary withdrawal rules; only the admin can
retire it. Retiring channel 0 does not retire other channels.

### Full refunds and destinations

`refund(customer, channelId)` is permissionless, but the caller does not supply
a recipient. It returns the full remaining balance to the customer's stored
refund recipient, defaulting to the customer itself. It also clears the ordinary
withdrawal request, ready time and position funding-cycle deadline. The voucher
key, lifetime paid total and configured refund recipient remain unchanged.

Only the customer can use `setRefundRecipient(channelId, recipient)`, before or
after the refund deadline. Zero and the PayToPlay contract itself are rejected.
This setting applies only to full refunds, not ordinary withdrawals. It changes
no deadlines or voucher rights. A rejecting recipient rolls back that refund
and retains its entitlement; it cannot block other positions. The owner may
correct the destination and a relayer can retry. A lost owner key is not fixed
by a timeout: configure an accessible recovery destination in advance.

After a successful full refund, an open-channel position can be funded again.
An empty expired cycle may need a zero refund before reuse. Existing unpaid
vouchers remain applicable to new backing. A retired channel cannot be reused.

### Return all funds operationally

`channel(channelId).escrowTotal` is the sum of credited customer balances. It
tracks actual funding, voucher payments, withdrawals, outgoing/incoming moves
and full refunds. A closed channel with `escrowTotal == 0` has no accounted
customer balance left. Forced, uncredited native transfers are not assigned to
a channel and are not included in this total.

Use the [bounded refund worker](../../js/tools/pay-to-play-refunds/README.md)
to discover positions from funding and incoming-move events, plan refunds and
optionally execute bounded batches. Anyone can also execute individual refunds
through the recovery screen. Discovery of all customers requires complete
historical event coverage, not only the blocks near closure. Execution is
independent per position; it never depends on an all-customers transaction.

## Integration reference

Sources: [contract](src/PayToPlay.sol), [ABI](cam/abi/PayToPlay.json),
[CAM routes](cam/main.json), [UI](cam/ui.json),
[design record](../../notes/020_service_payment_channels.txt),
[invoice codec and signing helpers](../../js/tools/pay-to-play-vouchers/README.md),
[v2 migration record](../../notes/029_pay_to_play_invoice_v2.txt), and
[CAM protocol](https://numpde.github.io/dapp32/reference/cam/1.3.0/).

### Locate and verify the payment contract

Read `camManifest()` and `contractAddress("PayToPlay")` on the CAM host. Verify
the exact manifest/resource bytes and chain/binding before preparing signatures
or calls. The CAM host is not the payment contract: use the bound PayToPlay
address as the EIP-712 verifying contract. The worker separately requires a
verified runtime-bytecode hash for that deployment.

Complete CAM contract-binding updates and verify that the host's payment binding
matches the signing helper's payment contract. Then reload the viewer before
preparing signatures or transactions; an open viewer may retain earlier addresses.
Reloading alone cannot fix a mismatched deployment. The read-only signing projection rejects a host whose current payment
binding differs from the payment contract it was deployed for. This guard does
not prove that every cached address in an open viewer matches it. Compare the
signing domain's `verifyingContract` with the payment target shown in transaction
review. Adding or replacing the read-only helper does not move deposits or change
issued vouchers.

### Sign a voucher outside the viewer

Read the confirmed, nonzero `viewPosition(...).voucherKey`. K signs this typed
data; `customer` remains the deposit owner even when K is a different account.
Compute the invoice hash from the agreed immutable document, rather than hashing
arbitrary JSON formatting. The helper guide defines the supplied service codec.

```json
{
  "domain": {
    "name": "PayToPlay",
    "version": "2",
    "chainId": "<deployment chain ID>",
    "verifyingContract": "<PayToPlay address>"
  },
  "types": {
    "EIP712Domain": [
      {"name": "name", "type": "string"},
      {"name": "version", "type": "string"},
      {"name": "chainId", "type": "uint256"},
      {"name": "verifyingContract", "type": "address"}
    ],
    "Voucher": [
      {"name": "customer", "type": "address"},
      {"name": "channelId", "type": "uint256"},
      {"name": "cumulativeTotal", "type": "uint256"},
      {"name": "invoiceHash", "type": "bytes32"}
    ]
  },
  "primaryType": "Voucher",
  "message": {
    "customer": "<balance owner address>",
    "channelId": "<channel ID>",
    "cumulativeTotal": "<lifetime authorized total in wei>",
    "invoiceHash": "<0x followed by exactly 64 hexadecimal digits>"
  }
}
```

Use a canonical 65-byte `r,s,v` signature with low s and v equal to 27 or 28.
Compare its EIP-712 digest with `voucherDigest(customer, channelId, total, invoiceHash)`;
do not sign that digest as a personal message. The signing-details screen supplies
a comparison digest and invoice reference, not a signature or invoice approval.
Arbitrary current ERC-1271 approval is not accepted instead of K's ECDSA signature.

### Contract and route API

All monetary quantities and IDs are uint256; periods are uint64 seconds.
Invoice references are bytes32; signatures are bytes.

| Function | Authority and effect |
| --- | --- |
| `asset()` | Read the contract's immutable native-asset identifier, the ERC-7528 sentinel `0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE`. It identifies the native asset; it does not provide a symbol, decimals or display labels. |
| `channelCount`, `channel(id)` | Read channel directory, payee, collector, claim period, close deadline and escrow total. |
| `viewPosition(customer, id, actor)` | Read balances, key, ordinary request, scheduled/effective recovery dates, phase, recipient and contract-derived action IDs. |
| `voucherDigest(customer, id, total, invoiceHash)` | Read EIP-712 digest; does not establish signature validity, invoice validity or collectibility. |
| `registerVoucherKey(id, key)` | Customer permanently registers a nonzero key in an operating, nonzero channel. |
| `fund(id, amount)` payable | Require `msg.value == amount`, then credit the sender; positive funding renews the operating cycle. For an operating position, zero amount with zero value changes nothing. |
| `collect(customer, id, total, invoiceHash, maxAmount, signature)` | Only the channel collector submits K's voucher; authenticate its reference and pay up to maxAmount to the current channel recipient, only before recovery cutoff. |
| `requestWithdrawal(id, amount)` | Customer starts an ordinary request only if none exists. |
| `setWithdrawal(id, amount)` | Customer replaces/starts an ordinary request and wait while operating. |
| `withdraw(customer, id)` | Anyone consumes a mature request, paying the customer. |
| `move(source, target)` | Customer consumes a mature source request into its operating target position. |
| `renewPosition(id)` | Customer extends an already-scheduled operating cycle. |
| `closePosition(customer, id)` | Customer/admin/payee starts early settlement without postponing an earlier deadline. |
| `closeChannel(id)` | Admin/payee starts irreversible channel retirement; no customer iteration. |
| `setRefundRecipient(id, recipient)` | Customer changes only its full-refund destination, in any phase. |
| `refund(customer, id)` | Anyone executes due full recovery to the stored destination. |
| `createChannel(payee, collector, period)`, `setPayee(id, payee)` | Admin-only; payee must be nonzero, period is capped at 30 days, and recipient changes stop after channel closes. Zero collector starts the channel paused. |
| `setCollector(id, collector)` | Admin changes only that channel's collector; zero pauses collection. Channel 0 cannot have a collector. |

The UI route `recovery(customer, channelId)` reads the same complete position
snapshot as `position`. Recovery writes continue to that screen. Sender-owned
renewal/recipient writes capture the acting account; closure and refund writes
preserve the explicitly inspected customer. `closeChannel` has a route-level
customer input solely for that continuation; it is not a Solidity argument.
Other routes use contract names, except `move` maps route `channelId` to source
and `fund` maps route `amount` to both the Solidity argument and transaction
value. The contract rejects any mismatch. Consult the manifest.

The asset identifier is contract-wide and immutable; there is no per-channel
asset setting or ERC-20 funding path. The current CAM `AmountField` declares
native amounts in base units with 18 decimals and labels them “Wei” and “Native
coins”. Those labels and decimals are UI metadata; `asset()` identifies the
asset but does not supply display metadata.

`VoucherCollected(customer, channelId, payee, amount, voucherPaid, invoiceHash)`
reports actual cumulative settlement using the referenced voucher, not an
invoice-specific allocation. Customer, channel and payee are indexed; invoiceHash
is non-indexed. A valid zero collection emits no collection event. A successful
receipt alone therefore does not establish that a purchase was paid.

Recovery events are `PositionRenewed`, `PositionClosing`, `ChannelClosing`,
`RefundRecipientChanged` and `Refunded`, in addition to payment/withdrawal/key
and ownership events. Ordinary zero/no-op calls may emit no event. Phase changes
caused only by time emit no event: monitor deadlines as well as event streams.

A service must maintain durable purchase IDs, disjoint cumulative reservations,
and outstanding signed exposure, including disclosed vouchers attached to
rejected or expired invoices. With balance B, withdrawal request R, actual paid
P and greatest outstanding signed/reserved total A, a conservative admission
check for additional work x is `max(A-P,0) + x <= max(B-R,0)`. Count outstanding
authority and reservations, not just the new purchase. This is service policy,
not an onchain reservation: collection can use the actual balance B, including
funds under a withdrawal request, and can race withdrawals or other collections.
Stop accepting new work when settling; collect claims before the applicable
deadline, accounting for already-pending ordinary withdrawals, confirmations,
inclusion delay and recipient failures. An enabled UI control or a signed
voucher alone is not a backing reservation.

### Deployment compatibility

These contracts are not upgradeable. Existing deployments retain their old
code and policy. Deploy a new PayToPlay contract and bind it to a matching CAM
publication; changing only the ABI or manifest does not add `asset()` or change
the legacy `fund(uint256)` selector to `fund(uint256,uint256)`.
Use ABI and UI resources exported for the exact deployed contract, including
its Channel and PositionView tuple layouts. The voucher domain is PayToPlay/2;
its four-field message and new verifying-contract address separate it from v1.
The old three-field schema, old function selectors and version-1 domain are not
accepted by this deployment. There is no automatic balance, voucher or key
migration. Update signing clients, event consumers and refund-worker deployment
and runtime-code pins together; old outstanding authorizations stay with their
original deployment.

## Deployment

See the [published Pay-to-Play deployment guide](https://numpde.github.io/dapp32/deployment/pay-to-play/) for release inputs, authority handoffs and verification. The [shared deployment guide](https://numpde.github.io/dapp32/deployment/) explains the release workflow.

## Supply a local deployment to another repository's tests

This repository starts and stops the temporary blockchain and deploys the contracts.
The other repository's test runner starts its own services and tests them against
that deployment. Call these targets
from a prepared checkout; Solidity dependencies must already be installed through
`make dapps/deps/install`. This fixture does not need the JS workspace installed.

| Target | Input | Effect |
| --- | --- | --- |
| `pay-to-play/local/fixture/up` | `FIXTURE_ID` | Start a fresh internal Anvil and CAM HTTP service, deploy once, and verify readiness. Leave them running on success; attempt cleanup on failure. |
| `pay-to-play/local/fixture/info` | The same `FIXTURE_ID` | Check the running deployment and print its connection details as JSON. A temporary reader container performs the checks. |
| `pay-to-play/local/fixture/down` | The same `FIXTURE_ID` | Remove that fixture's services, network and deployment volume. Safe to repeat. |

Choose a different ID for each concurrent run: 1–48 lowercase letters, digits,
underscores or hyphens, beginning with a letter or digit. `up` refuses an ID with
existing fixture resources. It never resumes or redeploys into that state.
Fixtures use dedicated projects prefixed `dapps-pay-to-play-fixture-`, separate
from the scenario and GUI projects. Use the same local Docker daemon for this repository
and the consuming test containers.

In this example, `DAPPS_CHECKOUT` is this checkout's path, `RUN_ID` identifies
one test run, and `RUN_DIR` is an existing directory for test output:

```sh
make -C "$DAPPS_CHECKOUT" pay-to-play/local/fixture/up FIXTURE_ID="$RUN_ID"
# Register cleanup after successful startup; first stop P2P's own containers,
# then call fixture/down with this RUN_ID, including when the scenario fails.
make -s -C "$DAPPS_CHECKOUT" pay-to-play/local/fixture/info \
  FIXTURE_ID="$RUN_ID" > "$RUN_DIR/fixture.json.tmp"
mv "$RUN_DIR/fixture.json.tmp" "$RUN_DIR/fixture.json"
```

`info` writes only JSON to stdout; operational diagnostics go to stderr. It
checks chain ID 31337, all deployment receipts against their recorded blocks,
successful transaction status, and that all three deployed addresses contain contract
code. It does not compare that code with compiler output. The JSON contains:

- `composeProject` and `dockerNetwork`: the fixture's cleanup identity and the
  existing internal network the consumer joins.
- `rpcUrl` and `chainId`: connection details usable from that Docker network.
- `contracts.CamRoot`, `contracts.PayToPlay` and `contracts.PayToPlayUI`: each has
  `address` and the mined `deploymentBlock`. Use PayToPlay for voucher signatures
  and payments; PayToPlayUI only reads signing details.
- `publicFixtureAccounts`: `admin`, `customer`, `relayer` and `payee`, each with
  `address` and `privateKey`. These are intentionally public test identities;
  their addresses are derived by the deployment from its existing fixture keys.

P2P attaches its test container to `dockerNetwork`, for example with a Compose
network declared `external: true` and `name` set to that value. Configure its
normal RPC client with `rpcUrl`. No RPC port is published on the host. A peer on
this network can use Anvil's test-only mutation methods; this is a trusted test
environment. Stop attached P2P containers before tearing down the fixture network.

After stopping its own containers, the runner calls this command even if its
tests or `info` failed. Register that cleanup as soon as `up` succeeds:

```sh
make -C "$DAPPS_CHECKOUT" pay-to-play/local/fixture/down FIXTURE_ID="$RUN_ID"
```

Fresh deployments have only channel 0 and funded test accounts. The P2P scenario
creates its channels, registers voucher keys and deposits through normal contract
calls. Fixture readiness establishes a usable deployment; the consuming test
must still prove invoice acceptance, collection and service accounting together.

## Run the disposable local demo

Use Docker, Compose and Make as a non-root user. Install locked dependencies
explicitly when needed:

```sh
make dapps/deps/install
make js/deps/install
make pay-to-play/local/demo/gui/up
```

Keep that foreground command running and open the printed loopback URL (port
5175 by default). A new chain is 31337 and contains only channel 0. The GUI
fixture and its chain are disposable; stopping/restarting supervised services
can remove the chain state. The frontend stages source at startup, not by
mutating the read-only checkout.

Connect a compatible wallet. To attach the existing local test wallet to a tab
in an already-running CDP browser, use verified deployment values:

```sh
make viewer/local/fixture-wallet/attach \
  FIXTURE_WALLET_APP=pay-to-play CDP_TARGET_ID='<existing-tab-id>' \
  CDP_ORIGIN=http://127.0.0.1:9222 VIEWER_URL='<printed viewer URL>' \
  EXPECTED_CAM_URI=http://127.0.0.1:5175/cam/main.json \
  EXPECTED_CAM_HASH=0x... EXPECTED_CONTRACT_ADDRESSES='{"PayToPlay":"0x..."}'
```

The attachment verifies the tab/origin/host/chain/manifest/contract and refuses
an existing wallet. It starts no browser or chain. Its account names are public
fixture identities, not permissions. The existing attachment's transaction
allowlist includes payment, ordinary withdrawal and recovery operations, scoped
to this local contract. It initially selects the customer. Use its selector to
change accounts, then let the app update before reviewing a call. Contract
permissions still apply.

Keep the attachment command running as well as the GUI command. It asks for
confirmation before sending a local transaction. Reloading resets the selector
to the customer; connect the wallet again in the app. Stopping the attachment
removes its provider and selector without closing the tab. To find an existing
tab's ID, inspect `http://127.0.0.1:9222/json/list` in the browser's CDP setup.

For the manual payment example, use admin to create a nonzero channel and read
its exact ID from the `ChannelCreated` receipt event (not from an observed
channel count). Connect the fixture customer, open its position, register its
own address as K, and deposit. Prepare the invoice's exact hash using the agreed
codec, then sign with the fixed local customer key:

```sh
make pay-to-play/local/voucher/sign \
  PAY_TO_PLAY_ADDRESS=0x... PAY_TO_PLAY_CHANNEL_ID=1 PAY_TO_PLAY_TOTAL=100 \
  PAY_TO_PLAY_INVOICE_HASH=0x...
```

Replace the invoice-hash placeholder with exactly 32 bytes, not a URL, an invoice
ID or the document itself. Enter the same hash and total in the collection form.
Use the payment contract address, not the host. This offline command does not
register a key or validate an invoice and works only when that fixed signer was
registered for the position. A different K requires a signature from K. Keep
signature output out of logs and commits. The payment and recovery scenarios
both use a voucher key distinct from the deposit owner.

```sh
make pay-to-play/local/demo/gui/down
```

### Verify the workflows

Before integration or publication, regenerate the ABI and confirm that it matches
the checked-in v2 resources:

```sh
make cam/abi/export
git diff -- dapps/pay-to-play/cam
make tests
```

`make tests` includes Solidity unit/scenario, fuzz and invariant campaigns,
JS and tool checks, and disposable real-RPC payment/recovery scenarios. It also
runs the repository's other automatic campaigns and uses network access for
the dependency-egress check. For focused Pay-to-Play verification:

```sh
make js/tests
make pay-to-play/local/recovery/run
make pay-to-play/refunds/check
make cam/conformance/check
```

The payment scenario signs canonical invoices, compares v2 digests with the
contract, rejects substituted references, decodes actual collection events,
and checks later-invoice-first partial settlement and external merchant receipts.
The recovery target runs that scenario first, then verifies renewal, early
closure, exact annual phase transitions, recipient selection, permissionless
full refund, reuse, and multi-customer channel retirement. It retains checks for
incoming-move discovery and the file-backed refund CLI with one-transaction
batches and journal persistence, and exercises unpaid invoice vouchers through
refund/refill. It uses a private disposable chain, advances only fixture time,
and cleans up through the maintained scenario lane. It also checks that a
confirmed receipt followed by a journal-write failure is fatal, rather than
falsely reported as pending. The refund worker's offline check runs in
`make js/ci`; the combined real-RPC scenario runs in `make tests`. Neither selects
an operator deployment. Invoice-helper tests run in `make js/tests`.

The optional browser check uses an existing browser and a disposable local GUI:

```sh
make pay-to-play/live/browser/check \
  CDP_ORIGIN=http://127.0.0.1:9222 VIEWER_URL='<printed viewer URL>' \
  EXPECTED_CAM_URI=http://127.0.0.1:5175/cam/main.json EXPECTED_CAM_HASH=0x...
```

It creates and closes its own tab in that browser. Its 11 transactions cover
invoice-bearing payment/withdrawal workflows and, in a separate zero-wait
channel, choosing a refund recipient, starting wind-down and relaying a refund.
It checks invoice-hash entry, digest/reference display, restored voucher drafts,
collection event fields, 320px layout, time display and publication integrity
rejection. It does not exercise every recovery operation in the browser; renewal
and channel retirement have contract, viewer and real-RPC scenario coverage.
Point it at a disposable fixture, not a demo whose state you need to preserve:
it submits transactions. Local fixture success establishes local behavior,
not a production deployment or delivered API service.
