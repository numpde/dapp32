---
title: "Choose an app or local demo"
description: "Choose disposable practice or an existing published app, then follow its workflow guide."
outline: false
---

# Examples and local demos

<div class="ported-guide">


<p>For a first run, follow <a href="../start/local-wallet.html">Pay-to-Play with a local test wallet</a>. It reaches a deposit and cleanup without real credentials. To open an existing public testnet instance, use the <a href="../gallery/">Gallery</a> instead. The examples below run on your local Docker engine.</p>
<section id="apps"><h2>Workflow guides</h2>
<div class="grid">
<section class="card"><h3><a href="../pay-to-play/">Pay-to-Play</a></h3><p>Fund a position, authorize voucher payments, withdraw and recover balances.</p><p><a href="../deployment/pay-to-play/">Deployment settings</a></p></section>
<section class="card"><h3><a href="../escrow/">Escrow</a></h3><p>Create agreements, fund work, resolve disputes and withdraw settlement credit.</p><p><a href="../deployment/escrow/">Deployment settings</a></p></section>
<section class="card"><h3><a href="../bike-nft/">Bike NFT</a></h3><p>Register components and manage ownership, metadata and workshop access.</p><p><a href="../deployment/bike-nft/">Deployment settings</a></p></section>
</div></section>
<section id="local-demos"><h2>Local demos</h2>
<p>Each launcher creates its own disposable Anvil chain on ID 31337, deploys the app, serves its CAM files and prints a viewer URL. It does not attach a wallet automatically. Complete <a href="../development/">source setup</a> first.</p>
<div class="table-scroll" role="region" aria-label="Table: App / Start" tabindex="0">
<table><thead><tr><th>App</th><th>Start</th><th>Stop</th></tr></thead><tbody>
<tr><td>Pay-to-Play</td><td><code>make pay-to-play/local/demo/gui/up</code></td><td><code>make pay-to-play/local/demo/gui/down</code></td></tr>
<tr><td>Escrow</td><td><code>make escrow/local/demo/gui/up</code></td><td><code>make escrow/local/demo/gui/down</code></td></tr>
<tr><td>Bike NFT</td><td><code>make bike-nft/local/demo/gui/up</code></td><td><code>make bike-nft/local/demo/gui/down</code></td></tr>
</tbody></table>
</div>
<p>Add <code>DOCKER_CONTEXT=your-local-context</code> and use the same <code>COMPOSE_PROJECT_NAME</code> for startup, wallet attachment and shutdown. Keep the foreground launcher running and open its entire printed URL. Closing the browser tab does not stop the fixture.</p>
<p>The <a href="../start/local-wallet.html">complete wallet tutorial</a> shows the separate browser profile, attachment, actor selection and transaction approval. The other app guides retain their app-specific exercises. All fixture keys are public test identities; never use them with real funds.</p>
<p>To rehearse the actual operator approval/publication process rather than just explore an app, use the <a href="../deployment/#rehearse-the-release-locally">isolated release rehearsal</a>. Its deployment process and chain are separate from these demos.</p>
</section>

</div>
