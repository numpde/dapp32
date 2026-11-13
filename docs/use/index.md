---
title: "Open an existing app"
description: "Use a hosted viewer or launch one locally for an existing publication without redeploying contracts."
outline: false
---

# Use an app

<div class="ported-guide">

<p class="lede"><a href="../gallery/">Browse deployed apps</a> to choose an instance and open it directly. No address copying or contract deployment is needed.</p>

## Choose your app guide {#apps}

<dl class="task-routes">
<dt><a href="../pay-to-play/">Pay-to-Play</a></dt><dd>Fund a channel, authorize voucher payments, withdraw or recover a balance.</dd>
<dt><a href="../escrow/">Escrow</a></dt><dd>Create an agreement, submit work, resolve disputes and withdraw settlement credit.</dd>
<dt><a href="../bike-nft/">Bike NFT</a></dt><dd>Register components, inspect their records and manage ownership or workshop access.</dd>
</dl>

For disposable practice before using your wallet, follow the [local-wallet tutorial](../start/local-wallet.html).

## Open an unlisted app {#hosted}

For an app not in the directory, you need its trusted network and **CAM host address**, a compatible viewer and browser-readable RPC access. You do not need a deployer's private key or a new contract deployment.

Choose the [stand-alone viewer](https://app.dapp32.com/) (deployed independently) or the <a href="../viewer/">Pages preview</a> (a newer, experimental build that may change sooner). Both run in your browser and contact the selected RPC/resource hosts directly. Use the same CAM root and chain; wallet permissions are separate for the two website origins.

1. Get the chain and CAM host from the publisher. A business-contract address is not necessarily a CAM host.
2. Open a compatible viewer. In **Open a contract app**, choose the network and enter the host. A custom chain uses the form `eip155:43113`, for example.
3. Select a browser-accessible RPC. Leave the viewing address blank for a public view, or enter an address to inspect account-dependent state.
4. Check the resulting chain, host and resource information. Resolve integrity warnings or unexpected bindings before proceeding.

The viewer browser fetches the resources and RPC itself. HTTPS, CORS and Download scope must allow those requests. Never paste a private signing endpoint or secret API credential into a shared viewer URL.

## Run a local viewer for your saved publication {#local-publication}

<dl><dt>Run on</dt><dd>Your workstation, in the source checkout, after <a href="../development/">dependency setup</a>.</dd><dt>Requires</dt><dd>An existing private instance containing a completed compatible publication.</dd><dt>Changes</dt><dd>A local viewer runtime. No chain deployment, signing or CAM update.</dd></dl>

```sh
INSTANCE=/absolute/private/pay-to-play-fuji
make viewer/release/up \
  DOCKER_CONTEXT=your-local-context INSTANCE="$INSTANCE"
```

Replace the context and instance path. Choose the saved publication and a browser-public RPC; the launcher does not expose the private signing RPC. Open the complete printed URL in your regular browser. The initial viewing address comes from the publication record; it is not automatically a connected signer.

Connect a wallet separately for transactions. Do not attach the public fixture wallet to a public deployment. Stop the local runtime with:

```sh
make viewer/release/down \
  DOCKER_CONTEXT=your-local-context INSTANCE="$INSTANCE"
```

This does not remove contracts, stop a public blockchain or delete your retained instance records. To serve the viewer permanently on a server, use [Deploy the viewer](../viewer/deploy.html) instead.

## Authorize one action deliberately {#send}

Choose the app task, enter its inputs and prepare the call. Check the network, destination contract, function, arguments and native value. Connect the intended wallet, let account-dependent state refresh, and prepare again if the account changed. Only then authorize submission.

Inspect the receipt and resulting state. Simulation is a forecast; submission is a request; a successful receipt establishes execution. A receipt cannot establish off-chain service delivery.

## Refresh, Back and account changes {#navigation}

Refresh rereads state and invalidates a prepared transaction. Back can restore compatible drafts from session history while rereading state. Reloading or switching accounts can clear drafts. In Pay-to-Play, the inspected owner/channel stays fixed across actor changes; check both identities rather than assuming the viewed balance belongs to your connected wallet.

For exact verification and execution rules, use the [current protocol reference](../reference/cam/1.4.0/#security). Runtime baseline: [viewer setup at 04a18763](https://github.com/numpde/dapp32/blob/04a18763700bbaa25cad73b9806d236ab4d5e139/js/apps/cam-web/src/app-setup.tsx).

</div>
