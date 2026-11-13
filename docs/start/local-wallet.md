---
title: "Try Pay-to-Play with a local wallet"
description: "Create a local test channel, deposit 100 wei and remove the disposable fixture."
outline: false
---

# Try Pay-to-Play with a local wallet

<div class="ported-guide">

Create a test channel and deposit 100 wei. You will use public fixture accounts on a disposable local blockchain, not your real wallet.

<dl><dt>Run on</dt><dd>Your workstation, from the source checkout.</dd><dt>Requires</dt><dd><a href="../development/">Development prerequisites</a>, a local Docker context and Chrome or Chromium.</dd><dt>Changes</dt><dd>Local containers, temporary chain state and a dedicated browser profile. No public-chain transaction.</dd><dt>Success</dt><dd>A successful deposit receipt and a 100-wei balance in the selected test position.</dd></dl>

## 1. Start the app — terminal A {#launch}

Run from the source checkout. Replace `your-local-context` here and in the later commands with the same local engine:

```sh
make dapps/deps/install DOCKER_CONTEXT=your-local-context &&
make js/deps/install DOCKER_CONTEXT=your-local-context &&
make pay-to-play/local/demo/gui/up \
  DOCKER_CONTEXT=your-local-context COMPOSE_PROJECT_NAME=cam-demo
```

Leave the foreground command running. It deploys a fresh app on Anvil chain 31337 and prints a complete viewer URL, normally at `http://127.0.0.1:5175`. A fresh chain has only reserve channel 0; do not reuse an assumed service-channel ID from an earlier run.

## 2. Open the test browser and attach — terminals B and C {#wallet}

Follow [the shared isolated-browser step](fixture-wallet.html#browser) in terminal B. Open terminal A's **entire printed URL** in that browser, including its query parameters. Do not use a profile containing a real wallet.

In terminal C, from the same checkout:

```sh
make viewer/local/fixture-wallet/attach \
  DOCKER_CONTEXT=your-local-context COMPOSE_PROJECT_NAME=cam-demo \
  FIXTURE_WALLET_APP=pay-to-play \
  CDP_ORIGIN=http://127.0.0.1:9222
```

Select the matching tab if prompted, then connect the fixture wallet in the app. Keep both A and C running. The role selector starts on **customer**. The shared guide explains [browser confirmation](fixture-wallet.html#send), [reloads](fixture-wallet.html#refresh) and [detachment](fixture-wallet.html#stop).

## 3. Create a channel as admin {#channel}

Select **admin** in the fixture wallet and wait for the app to update. Open channel creation. For this local experiment, use the admin's displayed address as both payee and collector and choose a 60-second claim period.

Review the call, choose **Send with wallet** and confirm in the **browser dialog**. Read the channel ID from the successful receipt's `ChannelCreated` event, not from an observed channel count.

## 4. Deposit as customer {#deposit}

Select **customer** and wait for the refreshed view. Open a balance using that customer's displayed address and the channel ID from the receipt. Choose **Deposit** and enter **100 in the wei/base-unit input**, not 100 whole coins.

Review, send and confirm in the browser. Check the successful receipt and the resulting 100-wei balance. The six task destinations remain visible; **Balance** is the overview. Funding does not authorize a voucher payment: [registering a key and signing a voucher](../pay-to-play/#keys) are separate tasks.

## 5. Stop what you started {#stop}

Stop terminal C first to remove the injected wallet without closing the tab. Stop terminal A and let cleanup finish. To explicitly remove this demo:

```sh
make pay-to-play/local/demo/gui/down \
  DOCKER_CONTEXT=your-local-context COMPOSE_PROJECT_NAME=cam-demo
```

Close the dedicated browser. Its profile remains on disk; the fixture's chain state is disposable. Closing a tab alone does not stop the app. For wallet/role mismatches, use the [shared attachment guide](fixture-wallet.html); for a persistent website, use [Deploy the viewer](../viewer/deploy.html).

Source: [demo startup](https://github.com/numpde/dapp32/blob/04a18763700bbaa25cad73b9806d236ab4d5e139/dapps/pay-to-play/README.md#run-the-disposable-local-demo) and [fixture send confirmation](https://github.com/numpde/dapp32/blob/04a18763700bbaa25cad73b9806d236ab4d5e139/js/tools/browser-fixture-wallet.mjs#L243-L254).

</div>
