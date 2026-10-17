# Pay-to-Play

Deposit native coins into a contract, authorize payments with signed vouchers, and recover unspent funds after a withdrawal wait. You can make many offchain purchase authorizations before someone submits a voucher for onchain payment.

This repository implements the settlement contract and its user interface. It does **not** implement a service that sells API access, tracks purchase credits, provisions work or issues delivery refunds. Those responsibilities belong to a separate service integrating this contract.

[How it works](#from-deposit-to-payment) · [Whose balance?](#a-channel-is-shared-each-accounts-balance-is-separate) · [Use the app](#use-the-app) · [Vouchers](#a-voucher-authorizes-a-cumulative-total-not-a-new-charge) · [Withdrawals](#recover-or-move-funds-after-a-request) · [Channels and admin](#channel-0-and-channel-administration) · [Integration reference](#integration-reference) · [Local demo](#run-the-disposable-local-demo)

## From deposit to payment

Suppose Alice buys API access from Bob’s service. The admin has created channel 7 with Bob’s payment address as its recipient. For this small accounting example, all amounts are in **wei**, not whole native coins; transaction fees are separate.

1. **Alice deposits 100 wei into channel 7.** The contract holds the coins. It records a balance of 100 wei for Alice in that channel; Bob has not been paid.
2. **Alice authorizes a total of 30 wei.** She signs a voucher for her address, channel 7 and cumulative total 30. Signing does not send a transaction or transfer coins. Bob’s service must separately decide when to grant the purchased access.
3. **Someone submits the voucher.** Alice, Bob or a relayer can do this. The contract checks Alice’s signature and transfers 30 wei to the channel’s current recipient. Alice’s balance becomes 70; her lifetime total paid by vouchers becomes 30.
4. **A later purchase raises the authorized total to 50 wei.** A valid voucher for 50 can now pay another 20, not another 50, if Alice still has enough balance.

Funding alone authorizes no voucher payment. A signature authorizes payment but does not prove a purchase was delivered. The separate service must retain purchase records, reconcile actual collections and handle retries and refunds.

## A channel is shared; each account’s balance is separate

A **channel** is a numbered payment arrangement shared by all customers. It defines one current payment recipient and one fixed withdrawal waiting period. A channel does not belong to a single customer.

A **balance owner**, called `customer` in the contract, is the account whose deposited coins and authorizations are being tracked. Every pair **(balance owner, channel ID)** has its own current balance, lifetime voucher-paid total and optional withdrawal request. The contract calls this a *position*; it is accounting inside the same contract, not a separate wallet or deployment.

Alice’s balance in channel 7 is independent of her balance in channel 8 and Bob’s balance in channel 7. Bob being channel 7’s recipient does not make him the owner of Alice’s deposit. When a voucher is collected, the coins go to Bob’s recipient address, not to Bob’s deposited balance in the contract.

**Four identities to check before acting**

| Identity | What it controls |
| --- | --- |
| **Balance owner** | Whose balance you opened; whose signature authorizes vouchers; who may request withdrawals or move those funds. |
| **Current payment recipient** (`payee`) | Where collected vouchers pay. The admin can change this address for the entire channel. |
| **Connected wallet** | The account that signs and sends a transaction after you confirm. It may differ from the balance owner or recipient. |
| **Channel admin** | The contract owner, who creates channels and changes recipients. Admin status does not authorize spending another account’s balance. |

The viewer’s **Selected account** is used to calculate available actions. Before connecting a wallet it can come from the page URL; connecting uses the wallet’s active account. Selecting or viewing an address is not proof that you can sign for it. Sending requires the connected wallet to match the acting account used for review.

### Who can do what?

| Operation | Required authority and destination |
| --- | --- |
| Deposit | The sending account funds its *own* balance in the chosen channel. In the app, open that account’s balance and connect its wallet. |
| Sign a voucher | The balance owner signs externally. The app displays signing details but does not create this signature. |
| Submit a voucher | Anyone, with a valid owner signature. Payment goes only to the channel’s current recipient. Unavailable in channel 0. |
| Request or replace a withdrawal | Only the balance owner. A new or replacement amount must be positive and no greater than the current balance. |
| Complete a ready withdrawal | Anyone. Payment goes only to the balance owner. |
| Move a ready withdrawal | Only the balance owner. The destination is another channel balance for that same owner. |
| Create a channel or change its recipient | Only the admin. Channel 0 has no recipient to change. |

## Use the app

1. **Choose the balance owner and channel, then Open balance.** This is a read, not a transaction. The initial chooser defaults to the selected account and channel 0. Connecting a wallet on that initial chooser updates the account default. Channel 0 is explained below.
2. **Check Balance owner and Channel ID on the opened page.** They stay fixed when you connect or change wallet accounts. For example, opening Alice/channel 7 and switching to Bob’s wallet still shows Alice/channel 7. Owner-only actions are disabled; Bob may still submit Alice’s valid voucher or a ready withdrawal to Alice.
3. **Connect the wallet needed for your action.** Use Change account or channel to open a different balance; its chooser starts with the owner and channel already open. To deposit as Bob, open Bob’s balance, rather than trying to deposit into Alice’s displayed balance.
4. **Enter the inputs and choose Review.** The app prepares and simulates a transaction; no coins have moved. Inspect the contract, function, arguments and native amount to send.
5. **Choose Send with wallet and confirm.** This submits the transaction. Wait for a successful receipt before treating its effects as completed. A simulation can become stale before the transaction executes.

Amount fields offer linked whole-wei and decimal-native-coin inputs. One native coin is 1,000,000,000,000,000,000 wei. Disabled controls remain visible; an enabled control does not guarantee that an entered amount, target or signature is valid.

### Refresh, return and switch accounts

**Refresh** re-reads the current view from the latest block, including balances and available actions. It retains compatible unfinished inputs but discards any reviewed transaction. It does not reload app resources, mine a block or make a waiting withdrawal execute.

**Back** re-reads the previous view and restores compatible earlier inputs when this session has history. The balance link in voucher signing details opens fresh inputs. Reloading clears history and unfinished inputs; connecting or changing wallet accounts also clears unfinished inputs and recalculates permissions while keeping an opened balance’s owner and channel fixed.

## A voucher authorizes a cumulative total, not a new charge

For one owner and channel, the next collection is:

```text
payment = min(max(authorized total − lifetime actually paid, 0), current balance)
```

The signature must be valid even when this formula yields zero. The lifetime paid total increases only by coins actually transferred through voucher collection. Deposits, withdrawals and moves do not reset it.

**Partial collection and refill: one valid voucher for 100 wei, starting with zero lifetime paid**

| Action | Current balance afterward | Lifetime actually paid |
| --- | --- | --- |
| Start with a 30 wei balance; submit the voucher | 0 wei | 30 wei |
| Deposit another 20 wei | 20 wei | 30 wei |
| Submit the *same* voucher again | 0 wei | 50 wei |

That voucher can still collect up to 50 more wei from later funding. There is no voucher expiry or cancellation operation. Withdrawing or moving the balance does not revoke unpaid authorization: it can collect from later deposits or funds moved back into the same owner/channel. An older voucher can still pay if its total exceeds actual lifetime payments, even when a newer voucher exists. A higher signed total does not invalidate lower ones.

The signature binds the owner, channel, total, chain and payment contract. It **does not bind the recipient**: changing the channel’s recipient redirects unpaid amounts from vouchers already signed. Contract-wallet authorization is checked when collection executes, so its validity can change.

## Recover or move funds after a request

1. **The owner requests an amount.** It must be positive and no greater than the current balance. The channel’s full wait starts at the timestamp of the block that records the request, not when Review or wallet confirmation is clicked.
2. **Wait until the chain reaches the ready time.** The owner may replace the request with another valid amount. Every replacement restarts the full wait, even for the same or a smaller amount. There is no cancellation.
3. **Submit a withdrawal or move.** It transfers the smaller of the requested amount and current balance, then clears the entire request, including when the amount transferred is zero. A withdrawal sends to the owner; a move credits the same owner in a different existing channel.

A request does **not** reserve coins. Vouchers can collect against the full current balance during the wait or after the request becomes ready. If 80 wei was requested and collection leaves only 40, completing the request returns or moves 40 and clears the request. Later funding then needs a new request and full wait before another withdrawal or move.

Before a request is consumed, deposits and voucher collections change neither its requested amount nor its ready time. A deposit into a balance with an existing ready request can therefore become withdrawable immediately, up to that request’s amount. The ordinary request operation is a no-op while any request exists, even if ready; use the explicit replacement operation to change it. The app disables the ordinary request button while a request exists.

**Balance minus withdrawal request** is `max(current balance − requested amount, 0)`. It subtracts no unpaid vouchers or outstanding purchases. It is not reserved backing or a promise that new authorizations are safe to issue.

Readiness uses the latest block’s timestamp. Date display shows UTC and exact Unix seconds; the optional relative display uses your device clock and does not control readiness. Refresh only reads the chain. A ready withdrawal is never automatic. On the local demo, waiting in real time may leave readiness unchanged until another transaction mines a block.

### Transaction order matters

A ready withdrawal and voucher collection have no priority over each other: execution order decides which consumes the remaining balance first. A valid signature does not guarantee funds will still be available. If a native-coin recipient rejects payment, the transaction reverts and its accounting changes, including request consumption, roll back.

## Channel 0 and channel administration

**Channel 0** holds deposits that vouchers cannot spend. It has no payment recipient. Its withdrawal wait is fixed at deployment; moving its funds to a payment channel requires a request and that wait, just like withdrawing. Deposits directly into a payment channel do not require moving through channel 0 first.

The admin creates other channels with a nonzero recipient and a fixed wait, which may be zero. Channels are shared across customers, are not deleted and keep their IDs. The admin can change a payment channel’s recipient but cannot change its wait, edit customer balances or sign for a customer.

Connect the admin wallet to create a channel from the chooser or an opened balance. Enter whole Days, Hours, Minutes and Seconds; the total is stored as seconds. Once any part is entered, blank parts mean zero. Recipient changes affect **all customers** in the channel and existing unpaid vouchers. Customers and services must trust the admin with this redirection power.

After creation, find the exact channel ID in the transaction’s `ChannelCreated` event using a receipt-inspection tool. The viewer displays the transaction hash but does not decode that event. It returns to a chooser with the ID blank. Do not infer your transaction’s new ID from a channel count observed before or after creation.

## Integration reference

Sources: [contract](src/PayToPlay.sol), [generated ABI](cam/abi/PayToPlay.json), [CAM routes](cam/main.json), [UI definition](cam/ui.json) and [CAM protocol reference](../../docs/reference/cam/1.2.0/index.html). The [design record](../../notes/020_service_payment_channels.txt) describes the separate service ledger and trust assumptions.

### Locate and verify the payment contract

Read `camManifest()` on the CAM host for its manifest URI and hash, and `contractAddress("PayToPlay")` for the payment contract address. Verify the manifest and declared resource bytes, chain and resolved binding before preparing calls or signatures. The **CAM host and payment contract are different roles**; the viewer header’s host address is not the voucher’s verifying contract. Use the payment address from a verified host binding or deployment output.

### Sign a voucher outside the viewer

Use an EIP-712 typed-data signer. Replace the deployment and message placeholders below; amounts and IDs are whole decimal integers. Use the deployment’s chain ID, not the local demo ID unless signing for that demo.

```json
{
  "domain": {
    "name": "PayToPlay",
    "version": "1",
    "chainId": "<deployment chain ID>",
    "verifyingContract": "<PayToPlay payment contract address>"
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
      {"name": "cumulativeTotal", "type": "uint256"}
    ]
  },
  "primaryType": "Voucher",
  "message": {
    "customer": "<balance owner address>",
    "channelId": "<channel ID>",
    "cumulativeTotal": "<lifetime authorized total in wei>"
  }
}
```

Compare the resulting EIP-712 digest with `voucherDigest` or the app’s signing-details screen. That screen supplies a digest, not a signature or the full domain address. Do not sign the digest as a personal message. Externally owned accounts and ERC-1271 contract wallets are supported through signature validation at collection time.

### Contract API

All amounts and channel IDs below are `uint256`; waits are `uint64` seconds. Read the ABI for complete types, events and custom errors. These are contract entrypoints, not HTTP service APIs.

| Function | Behavior |
| --- | --- |
| `channelCount()` / `channel(channelId)` | Read the count including channel 0, or a channel’s `payee` and `claimPeriod`. Valid IDs run from 0 through count minus 1. |
| `viewPosition(customer, channelId, actor)` | Read channel terms, admin, balances, request, effective balance and action route IDs for that actor. Supplying an actor does not authorize a transaction. |
| `voucherDigest(customer, channelId, cumulativeTotal)` | Read the EIP-712 digest; this does not validate a signature or prove collectibility. |
| `fund(channelId)` payable | Credit `msg.value` to the sender in that channel. Zero value is a no-op. |
| `collect(customer, channelId, cumulativeTotal, signature)` | Validate the customer’s voucher and pay the collectible delta to the current recipient. Return actual payment, possibly zero. |
| `requestWithdrawal(channelId, amount)` | Start the sender’s request if none exists. If a request already exists, return without validating the new amount or changing the request. |
| `setWithdrawal(channelId, amount)` | Create or replace the sender’s request and restart the full wait. |
| `withdraw(customer, channelId)` | Consume a ready request and send the actual amount to that customer. Any sender; return actual amount. |
| `move(sourceId, targetId)` | Consume the sender’s ready source request and credit their target-channel balance. Distinct existing channels required; return actual amount. |
| `createChannel(payee, claimPeriod)` / `setPayee(channelId, payee)` | Admin-only channel creation or recipient replacement. Creation returns the new ID and emits `ChannelCreated`. |

Events expose actual effects: `Funded`, `VoucherCollected`, `WithdrawalRequested`, `Withdrawn`, `Moved`, `ChannelCreated` and `PayeeChanged`. The ABI also includes the EIP-712 and two-step ownership interfaces inherited by the contract.

### CAM routes and agent behavior

`home` opens the chooser; `choosePosition(customer, channelId)` seeds it from an existing balance. `position(customer, channelId)` reads a pinned balance, and `voucherDigest` reads signing details. After creation, `channelLookup` offers a blank channel-ID lookup. Write routes use the contract names above, except `move` takes route inputs `channelId` and `targetId`, and `fund` takes `amount` as native transaction value. Consult the manifest for each exact input and continuation.

Agents must distinguish reads, prepared calls, simulation results, submission hashes and successful receipts. A prepared write continuation captures the acting account at preparation. Sender-owned writes return to that sender’s explicit balance; submitting a voucher or withdrawal returns to the specified customer’s balance. Neither simulated return values nor a refreshed count identify a channel actually created by a mined transaction; inspect its receipt event.

A service integration must maintain durable purchase IDs, cumulative authorizations, outstanding uncollected purchases and credit/provisioning records. The contract does not know every signed voucher or API liability. Budgeting from its displayed balance alone cannot account for these obligations, transaction races or service delivery.

## Run the disposable local demo

Use Docker with Compose and Make. Materialize locked dependencies first if needed with `make dapps/deps/install` and `make js/deps/install`; these are the explicit networked installation steps. Then run:

```bash
make pay-to-play/local/demo/gui/up
```

Keep this foreground command running and open its printed loopback URL on port 5175. A fresh chain has only channel 0 and uses chain ID 31337. Connect a compatible wallet or attach the maintained [local test-wallet selector](../../js/tools/browser-fixture-wallet.html) to your existing tab. The selector is a local fixture, not a wallet extension. Its named accounts are public test accounts; names confer no contract permissions.

1. Choose the fixture admin and connect it to create a payment channel. Retrieve the exact ID from the creation receipt.
2. Choose the fixture customer and connect it. Open that customer’s balance in the new channel, then deposit.
3. Sign a voucher externally. The fixed local customer can use the offline command below. A relayer can submit it; the recipient receives the payment.
4. Connect the customer to request funds back; after the chain reaches the ready time, complete the withdrawal or move.

```bash
make pay-to-play/local/voucher/sign \
  PAY_TO_PLAY_ADDRESS=0x... PAY_TO_PLAY_CHANNEL_ID=1 PAY_TO_PLAY_TOTAL=100
```

Use the actual local payment contract address and channel ID. This command signs only for the fixed fixture customer on chain 31337. It prints a voucher signature for pasting into the app; keep that output out of logs and commits. The selector’s transaction confirmation signs and submits immediately after confirmation; it does not sign vouchers. Reloading resets the selector to its configured initial account and requires connecting again.

**The chain is temporary.** Stopping the foreground GUI command, or restarting its supervised frontend or gateway, tears down the fixture and loses in-memory chain state. Viewer JavaScript is staged at startup; do not restart a live service to update code while expecting to preserve that chain. A normal new code session starts fresh. Stop the demo with:

```bash
make pay-to-play/local/demo/gui/down
```

The demo exposes its gateway only on loopback, uses read-only source mounts and temporary build outputs, and removes its containers and broadcast volume on teardown. It does not deploy to an operator-supplied chain.

### Verify the workflows

```bash
make pay-to-play/local/scenario/run
```

This maintained real-RPC test deploys its own disposable chain and drives published CAM actions for deposits, cumulative payments, partial retries, recipient changes, withdrawal replacement/completion and moves through channel 0. It signs externally and advances fixture time through RPC. It is included in `make tests`. Solidity tests cover further accounting, signature, permission and payment-failure cases; neither suite implements the service API or ledger.

The optional browser check needs an already-running local GUI and browser CDP endpoint. It opens a test tab in that existing browser and sends bounded fixture transactions; it starts neither the GUI nor a browser window:

```bash
make pay-to-play/live/browser/check \
  CDP_ORIGIN=http://127.0.0.1:9222 VIEWER_URL='<printed viewer URL>' \
  EXPECTED_CAM_URI=http://127.0.0.1:5175/cam/main.json EXPECTED_CAM_HASH=0x...
```

Use the SHA-256 of the exact checked-in `cam/main.json` bytes as the expected hash. These fixture checks establish local behavior, not production deployment or a working API-access service.
