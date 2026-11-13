---
title: "Attach a local test wallet"
description: "Use the existing shared fixture wallet in an isolated browser tab for Pay-to-Play, Escrow or Bike NFT."
outline: false
---

# Attach a local test wallet

<div class="ported-guide">

Use the demo's public test accounts without installing a wallet extension. The attachment targets one existing demo tab; it starts no blockchain, app or browser.

<dl><dt>Run on</dt><dd>The workstation running the local demo, from its source checkout.</dd><dt>Requires</dt><dd>A running GUI fixture on chain 31337, its complete printed URL and a separate Chrome/Chromium profile.</dd><dt>Changes</dt><dd>An injected wallet and role selector in that tab. Confirmed sends submit local test transactions immediately.</dd><dt>Success</dt><dd>The app connects to the selected fixture account and a permitted transaction reaches a successful receipt.</dd></dl>

## 1. Open a dedicated browser {#browser}

Keep the app's GUI-launch terminal running. Start this browser in another terminal; use `chromium` instead when that is your installed executable:

```sh
google-chrome \
  --remote-debugging-address=127.0.0.1 \
  --remote-debugging-port=9222 \
  --user-data-dir="$HOME/.cache/cam-local-test-browser" \
  --no-first-run
```

Open the **entire URL printed by the demo**, including its query parameters. Keep this profile exclusively for fixtures, with no real accounts or wallet extensions. The debugging endpoint controls that browser: keep it on loopback, never on a public interface.

## 2. Attach to the matching tab {#attach}

In another terminal, run from the same checkout. Replace the context, project and app with those used by your running demo:

```sh
make viewer/local/fixture-wallet/attach \
  DOCKER_CONTEXT=your-local-context COMPOSE_PROJECT_NAME=cam-demo \
  FIXTURE_WALLET_APP=escrow \
  CDP_ORIGIN=http://127.0.0.1:9222
```

<div class="table-scroll" role="region" aria-label="Table: App value / Selector accounts" tabindex="0">
<table><thead><tr><th>App value</th><th>Selector accounts</th><th>Initial account</th></tr></thead><tbody>
<tr><td><code>pay-to-play</code></td><td>admin, customer, relayer, recipient</td><td>customer</td></tr>
<tr><td><code>escrow</code></td><td>client, contractor, arbitrator</td><td>client</td></tr>
<tr><td><code>bike-nft</code></td><td>seller, mechanic, buyer</td><td>seller</td></tr>
</tbody></table>
</div>

The launcher reads the existing demo's saved deployment volume and finds tabs matching its origin, host and local chain. One match is selected automatically; several matches prompt in the terminal. It checks the manifest, ABIs and original contract bindings and refuses a tab that already has a wallet. You do not need to copy a tab ID, manifest hash or contract address.

Keep the attachment terminal running. Its account labels are not permissions: the contracts decide what those addresses may do. Attachment does not fund accounts. In particular, arrange local test gas for Bike's mechanic and buyer before asking them to send.

## 3. Connect, choose a role and confirm in the browser {#send}

Select **Connect wallet** in the app. Change accounts through the fixture selector and wait for the app's updated view before preparing another action. The selector's **Reconnect wallet** control requests connection using its current account.

After reviewing a transaction, choose **Send with wallet**. A **browser confirmation dialog** asks whether to submit as the selected fixture account. Confirming signs and submits immediately; cancelling sends nothing. There is no terminal approval ceremony for this injected fixture wallet. It is distinct from the operator release-approval tool.

Wait for a successful receipt and refreshed app state. A submitted transaction cannot be undone by closing the wallet. Voucher signing remains a separate signer task. Private fixture keys stay in the test process, not in the page's role selector.

## After editing or reloading {#refresh}

Reloading resets the selector to the app's configured initial account; reconnect in the app. After changing demo resources, use that app's `local/demo/gui/refresh` target with the same project and GUI settings. It preserves contracts and balances while rebuilding the viewer, checking CAM files and updating the fixture's manifest hash when needed. Reload and restart wallet attachment if its pinned manifest changed.

## 4. Detach, then stop the demo {#stop}

Ctrl-C in the attachment terminal removes the provider and selector and rejects pending requests without closing the tab. It prevents new signing/submission phases; it cannot reverse an already submitted transaction. After a forced kill, reload the tab before attaching again.

Stop the app's GUI launcher separately and let cleanup finish. Its matching `local/demo/gui/down` target removes the owned demo when necessary. Close the dedicated browser when finished; its profile remains on disk. Never use these public keys for real funds.

**No matching tab:** check the complete printed URL and matching context/project. **Existing provider:** use the dedicated profile. **Unavailable action:** inspect the account, loaded object and current contract state. Do not weaken attachment checks to bypass a mismatch.

Implementation: [browser confirmation and submission](https://github.com/numpde/dapp32/blob/04a18763700bbaa25cad73b9806d236ab4d5e139/js/tools/browser-fixture-wallet.mjs#L243-L254), [attachment identity checks](https://github.com/numpde/dapp32/blob/04a18763700bbaa25cad73b9806d236ab4d5e139/js/tools/browser-fixture-wallet-attach.mjs). Continue with [Pay-to-Play's first deposit](local-wallet.html), [Escrow](../escrow/) or [Bike NFT](../bike-nft/).

</div>
