---
title: "Pay-to-Play deployment settings"
description: "Choose payment and CAM authorities, reserve withdrawal wait and deployment compatibility before using the shared release procedure."
outline: false
---

# Pay-to-Play deployment settings

<div class="ported-guide">


<p>Choose these settings before following <a href="../new-instance.html">Deploy a new instance</a> with the <code>pay-to-play</code> prefix. Hosting a new viewer or publishing compatible navigation is not a reason to replace the payment contract.</p>
<h2 id="deploy-a-release">Choose independent authorities</h2>
<div class="table-scroll" role="region" aria-label="Table: Setting / Meaning" tabindex="0">
<table><thead><tr><th>Setting</th><th>Meaning</th></tr></thead><tbody>
<tr><td><code>INTENDED_PAYMENT_ADMIN</code></td><td>Creates service channels and changes their payees/collectors. This account does not acquire customer voucher-signing or refund-destination authority.</td></tr>
<tr><td><code>INTENDED_CAM_ROOT_OWNER</code></td><td>Changes workflow resources and contract bindings. It can differ from the payment administrator.</td></tr>
<tr><td><code>NULL_CLAIM_PERIOD</code></td><td>Reserve channel 0's fixed withdrawal wait, from 0 to 2,592,000 seconds. Zero means no wait. Service channels receive their own fixed waits later.</td></tr>
</tbody></table>
</div>
<p>The business operation creates <code>PayToPlay</code> with reserve channel 0. It does not create service channels or register customer keys. The separate <code>PayToPlayUI</code> projection supplies signing details; the CAM root binds both.</p>
<p>Use the shared procedure to prepare, host and publish the exact bundle. At an intentionally selected hosting pause, repeat the same operation and enter the hosted URI when prompted; do not start another deployment. Independent projection-deployer and CAM-owner configurations are described in <a href="../../reference/operations.html#configuration">operation inputs</a>.</p>
<h2 id="handoffs">Accept each nominated ownership separately</h2>
<p>If an intended owner differs from its current creator, the release nominates it; it does not sign acceptance on its behalf. The payment nominee calls <code>acceptOwnership()</code> on <code>contracts.payments.address</code> in the business artifact. The CAM nominee accepts on <code>root.contract.address</code> in the final publication artifact.</p>
<p>Neither handover has a built-in waiting period. The current owner retains authority until acceptance. Selecting the creator as final owner needs no handover. Later payment-admin changes use that payment contract's own <code>transferOwnership</code>/<code>acceptOwnership</code> sequence, independently of CAM ownership.</p>
<h2 id="release-verification">Check records and current readiness</h2>
<p><code>pay-to-play/release/verify</code> checks the selected operation's original-source evidence without signing. It accepts recorded pending handoffs as historical facts, not as completed current acceptance.</p>
<p>Before opening service, inspect both owners and pending owners, the intended root bindings, hosted-resource integrity and a known position read. Create any service channel under the payment admin, confirm its payee and collector, and select <code>ChannelCreated</code> by event topic rather than assuming it is the receipt's only log.</p>
<h2 id="compatibility">Qualify the clients before replacement</h2>
<p>Current calls include <code>createChannel(payee, collector, claimPeriod)</code> and capped, invoice-bound collection. A zero collector disables collection; only its configured nonzero address may submit vouchers. Clients must decode the collector field in channel and position views.</p>
<p>Vouchers use the PayToPlay/2 domain and the payment contract's address, not the CAM host. A replacement address invalidates old signatures for the replacement and moves no balances or permanent keys automatically. Preserve the original instance and make an explicit service/client migration decision before public cutover.</p>
<p>Use <a href="../update.html">Update an existing app</a> for compatible CAM or projection changes, <a href="../recovery.html">recovery</a> for incomplete retained work, and <a href="../source-verification.html">source verification</a> for Sourcify retries. <a href="../practice.html">Local release practice</a> uses separate public fixture credentials and no customer funds.</p>
<p>Source: <a href="https://github.com/numpde/dapp32/blob/04a18763700bbaa25cad73b9806d236ab4d5e139/dapps/pay-to-play/src/PayToPlay.sol">payment rules</a>, <a href="https://github.com/numpde/dapp32/blob/04a18763700bbaa25cad73b9806d236ab4d5e139/dapps/pay-to-play/script/PayToPlayContractDeployment.sol">creation and admin nomination</a>. <a href="../../pay-to-play/">User guide</a>.</p>

</div>
