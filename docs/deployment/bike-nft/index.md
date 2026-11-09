---
title: "Bike NFT deployment settings"
description: "Choose collection metadata, operational roles and independent ownership/admin handovers for a Bike NFT release."
outline: false
---

# Bike NFT deployment settings

<div class="ported-guide">


<p>Use these choices with <a href="../new-instance.html">Deploy a new instance</a>, substituting the <code>bike-nft</code> prefix. The normal release creates an <strong>empty collection</strong>; only the disposable demo registers the sample components.</p>
<h2 id="release-policy">Choose the authorities before setup</h2>
<table><thead><tr><th>Authority</th><th>What it controls</th></tr></thead><tbody>
<tr><td>CAM root owner</td><td>Manifest publication and contract bindings.</td></tr>
<tr><td>Components administrator</td><td>Roles on the ERC-721 collection, including its pauser and configurer.</td></tr>
<tr><td>Manager administrator</td><td>Registry roles, including pauser, configurer and registrars.</td></tr>
<tr><td>Registrars</td><td>Create serial records and mint components to their intended owners.</td></tr>
</tbody></table>
<p>Select explicit pauser/configurer addresses on both contracts and one or more unique registrars. The same account may hold several chosen roles; an unselected deployer role is not an intended standing permission. The release grants the manager the collection's mint/URI-setter roles and removes deployer operational roles unless explicitly selected.</p>
<p><code>COMPONENTS_ADMIN_DELAY</code> and <code>MANAGER_ADMIN_DELAY</code> are positive transfer delays. Public setup proposes 259,200 seconds (three days) for each and preserves prior choices when revisited. They delay administrator transfers, not ordinary pausing, configuration or role grants.</p>
<h2 id="token-and-collection-metadata">Choose collection identity and metadata</h2>
<p>Set the collection name and symbol. Use an <strong>empty base token URI</strong> for the generic viewer's complete URL/embedded-JSON workflow; setup's <code>none</code> choice means the empty string.</p>
<p>A nonempty base is an advanced suffix-client choice. The token contract concatenates it with every stored URI, including full URLs and data URIs. Changing that prefix affects existing tokens. Review <a href="../../bike-nft/metadata.html#base">the metadata boundary</a> before selecting or changing it.</p>
<p>Collection-level <code>contractURI()</code> is separate from token metadata and CAM. Setup's <code>inline</code> choice generates collection JSON containing its name; alternatively provide your own collection URI. Hosting JSON or images does not register any NFT.</p>
<h2 id="release-deployment"><span id="cam-publication"></span>Deploy and publish through the shared procedure</h2>
<p>Follow <a href="../new-instance.html">new-instance setup, approval and hosting</a>. Keep the whole private instance; <a href="../../reference/operations.html#artifacts">phase artifacts</a> identify the created collection, manager, projection and root. Public files are only the prepared bundle's contents.</p>
<p>Preserve exact manifest/resource bytes and browser access before approving the root publication. <code>CAM_HASH=auto</code> commits the prepared SHA-256; a zero commitment is unverified, not a substitute for a correct served bundle.</p>
<p>A compatible projection or workflow update can reuse Components and Manager through <a href="../update.html">the update procedure</a>. Updating the browser alone does not change contracts or add missing deployment-handover routes to an old publication.</p>
<h2 id="handoffs">Accept three independent handovers</h2>
<p>When a final authority differs from its creator, deployment submits a nomination, not acceptance. In <strong>Deployment handovers</strong>, connect the nominated wallet and inspect the exact target contract, current authority and acceptance time.</p>
<table><thead><tr><th>Target</th><th>Nominee action</th></tr></thead><tbody>
<tr><td><code>CamRoot</code></td><td><code>acceptOwnership()</code>; no CAM acceptance delay.</td></tr>
<tr><td><code>BicycleComponents</code></td><td><code>acceptDefaultAdminTransfer()</code> after its own delay.</td></tr>
<tr><td><code>BicycleComponentManager</code></td><td><code>acceptDefaultAdminTransfer()</code> after its own delay.</td></tr>
</tbody></table>
<p>Refresh handovers after chain time passes the deadline, review and send the relevant action, then inspect its successful receipt and updated authority. The old authority remains active until acceptance. No handover is needed when the creator is also the explicitly intended final authority.</p>
<p>For direct calls, Components/Manager addresses are in the business artifact; the root address is in the final CAM publication. Later administrator replacement uses that contract's <code>beginDefaultAdminTransfer</code> followed by nominee acceptance after its current delay. These transfers do not automatically change operational role holders.</p>
<h2 id="release-verification">Verify history, then inspect current state</h2>
<p><code>bike-nft/release/verify</code> checks retained original-source evidence without signing. Recorded pending nominations are valid historical facts, not proof that today's administration is accepted. Inspect current owners/admins, operational roles, pauses, metadata and publication separately.</p>
<p>Granting a role to a new account does not revoke the old holder. The relevant administrator must revoke it, or its holder can renounce it. Operational role changes have no administrator-transfer delay.</p>
<h2 id="public-rehearsal">Qualify the intended workflow</h2>
<p>Open the app through <a href="../../use/">a compatible viewer</a>; <a href="../../viewer/">server hosting</a> is separate from release deployment. Verify the selected chain/root/resources, then exercise registration, metadata, reports, reversible service state, temporary workshop access and owner handover using controlled test accounts.</p>
<p>Check that unauthorized accounts fail and that old workshop grants lose authority after transfer. Confirm collection and manager pause effects independently. Public source verification is a separate <a href="../source-verification.html">original-source publication task</a>.</p>
<h2 id="explicit-uncertainties-and-limits">What the records do not establish</h2>
<p>The administrator interface is not enumerable: current reads cannot discover every undisclosed role holder. Retained initialization/broadcast evidence and subsequent role-event coverage matter. Deployment records establish provenance, not physical component authenticity, future server availability or every later authority change.</p>
<p>Older irreversible-retirement or delegation designs retain their deployed meaning. Use compatible interfaces; a new CAM file is not a contract migration. Recover interrupted work through <a href="../recovery.html">retained-operation recovery</a>, not an automatic replacement.</p>
<p>Source: <a href="https://github.com/numpde/dapp32/blob/04a18763700bbaa25cad73b9806d236ab4d5e139/tools/release_config.py">setup fields</a> and <a href="https://github.com/numpde/dapp32/blob/04a18763700bbaa25cad73b9806d236ab4d5e139/dapps/bike-nft/script/BikeNftContractDeployment.sol">business initialization</a>. <a href="../../bike-nft/">User guide</a>.</p>

</div>
