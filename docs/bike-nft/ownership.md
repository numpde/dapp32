---
title: "Hand over a Bike NFT or authorize a workshop"
description: "Transfer a component NFT or grant temporary registry permissions without confusing the two authorities."
outline: false
---

# Hand over ownership or authorize a workshop

<div class="ported-guide">


<p>These are different transactions. A handover changes the NFT owner. A workshop grant permits selected registry updates without transferring the token.</p>
<h2 id="transfer">Transfer the NFT</h2>
<ol>
<li>Connect the current owner wallet and look up the exact component serial. Check the loaded collection, token ID and owner. Editing the search box alone does not change the loaded component.</li>
<li>Enter the intended recipient and choose <strong>Transfer NFT</strong>. Review the direct three-argument <code>safeTransferFrom</code> call on the loaded collection, including sender and recipient.</li>
<li>Authorize the transaction. After a successful receipt, refresh and confirm the new owner. A contract recipient must accept the ERC-721 safe transfer; a rejection reverts the ownership change.</li>
</ol>
<p>The operation collects no payment and checks no physical handover. Coordinate those separately. Manager pause does not stop token transfers; collection pause does. Taking a component out of service does not by itself prevent transfer.</p>
<h2 id="workshop">Grant temporary workshop access</h2>
<p>As the current owner, enter the workshop address and choose a duration within the displayed maximum. Select <strong>Inspect workshop and preview expiry</strong>. Check the address, current grant and proposed chain-time expiry before choosing a permission preset.</p>
<p>Presets allow metadata updates, reporting a component missing, resolving a report, or all three. <strong>Each preset replaces that workshop's existing capabilities and expiry.</strong> Choosing another single permission does not add it to the first. A grant never permits NFT transfer or service-state changes.</p>
<p>After its receipt, the workshop connects its own wallet and looks up the same component. The contract enforces the capability and expiry at execution. At the expiry timestamp, the grant is already inactive; the displayed preview is not a guarantee that a delayed transaction will succeed.</p>
<h2 id="revoke">Revoke or change a grant</h2>
<p>Inspect the workshop and choose <strong>Revoke workshop access</strong>, or submit a new complete preset/expiry. Only the current token owner can manage the grant. Registry pause can block these writes; check the current state before relying on a planned revocation.</p>
<p>Every successful change of token owner permanently invalidates earlier grants, including when the token later returns to the grantor. A self-transfer preserves them; a failed transfer changes neither ownership nor the grant generation. The new owner must explicitly authorize any continuing workshop work.</p>
<h2 id="service">Service state is not ownership or a missing report</h2>
<p>Only the owner can choose <strong>Take out of service</strong> or <strong>Reactivate</strong>. These actions do not open, resolve or erase a missing report. The current contract permits metadata corrections and ordinary transfers in either service state.</p>
<p>Older deployments with irreversible <code>Retired</code> records retain that policy. Updating viewer files does not add reactivation or expiring-grant semantics to old contracts. Check compatibility with <a href="../deployment/bike-nft/">the deployment guide</a>.</p>
<p>Source: <a href="https://github.com/numpde/dapp32/blob/04a18763700bbaa25cad73b9806d236ab4d5e139/dapps/bike-nft/src/BicycleComponentManager.sol#L297-L340">grant and revocation</a>, <a href="https://github.com/numpde/dapp32/blob/04a18763700bbaa25cad73b9806d236ab4d5e139/dapps/bike-nft/src/BicycleComponentManager.sol#L630-L664">effective permissions and expiry</a>, <a href="https://github.com/numpde/dapp32/blob/04a18763700bbaa25cad73b9806d236ab4d5e139/dapps/bike-nft/src/BicycleComponents.sol#L175-L184">ownership generation</a>. Return to <a href="./">Use Bike NFT</a>.</p>

</div>
