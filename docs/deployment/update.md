---
title: "Update an existing app"
description: "Choose a viewer, workflow-file, projection or business-contract update and follow its actual approval boundary."
outline: false
---

# Update an existing app

<div class="ported-guide">


<p>First identify what changed. A viewer image, workflow files and a contract are different components with different update procedures.</p>
<div class="table-scroll" role="region" aria-label="Table: Changed component / Procedure and authority" tabindex="0">
<table><thead><tr><th>Changed component</th><th>Procedure and authority</th></tr></thead><tbody>
<tr><td>Browser viewer</td><td>The server operator <a href="../viewer/deploy.html#maintain">replaces its image</a>. No CAM transaction.</td></tr>
<tr><td>Compatible labels, screens or navigation</td><td><a href="#cam-only">Prepare and host CAM files</a>; the current root owner approves their publication.</td></tr>
<tr><td>Read-only Solidity projection</td><td><a href="#projection">Deploy or select the projection</a>, then publish compatible resources/bindings. Deployer and CAM owner may differ.</td></tr>
<tr><td>Business behavior or incompatible ABI</td><td><a href="#migration">Plan replacement and migration</a>. This is not a UI refresh.</td></tr>
</tbody></table>
</div>
<h2 id="cam-only">Publish compatible navigation or screen changes</h2>
<dl><dt>Run on</dt><dd>The release operator's machine, in the reviewed source checkout, using its local Docker engine and private instance.</dd><dt>Requires</dt><dd>Retained evidence for compatible business/projection contracts and an existing CAM root; current publication-owner approval.</dd><dt>Changes</dt><dd>Prepared files and approved CAM reference/binding transactions, not an intended business-contract replacement.</dd></dl>
<p>These examples use Pay-to-Play; substitute the app prefix for another app. Verify its deployed ABI and policy before selecting today's authored files. A new operation must select the intended source revision; editing defaults does not rewrite an older operation's retained inputs.</p>
<pre><code>CTX=your-local-context &amp;&amp;
INSTANCE=/absolute/private/pay-to-play-fuji &amp;&amp;
make pay-to-play/release/verify DOCKER_CONTEXT="$CTX" INSTANCE="$INSTANCE" &amp;&amp;
make pay-to-play/release/cam/bundle DOCKER_CONTEXT="$CTX" INSTANCE="$INSTANCE"</code></pre>
<p>Select the compatible saved components and existing root. Preparation exports their original ABIs, combines authored files, refreshes pins and checks conformance. It sends no transaction. Inspect the selected identities and the printed bundle.</p>
<p>Host only that bundle's contents at a new versioned location, preserving paths and browser access. Compare the served bytes with the prepared files. Never upload private instance/configuration records.</p>
<pre><code>make pay-to-play/release/cam/publish DOCKER_CONTEXT="$CTX" INSTANCE="$INSTANCE"</code></pre>
<p>Select the prepared bundle and existing root, supply its manifest URI when prompted, and inspect every binding, hash and owner change before approval. This command does not upload files. A nominated future owner cannot publish before accepting.</p>
<h2 id="projection">Replace the read-only projection</h2>
<p>Use this path when screen data requires a new Solidity read helper but the business contracts remain compatible. Run from the selected projection/authored source, retaining the original backing-contract evidence and its source.</p>
<pre><code>make pay-to-play/release/ui/update DOCKER_CONTEXT="$CTX" INSTANCE="$INSTANCE"</code></pre>
<p>The menu offers a new projection, a saved projection or a saved update to resume. Choose the existing root and compatible backing contracts. The operation prepares matching CAM files and updates that root only through approved transactions; it does not replace the business contracts.</p>
<p>For a new hosting location, omit <code>settings.CAM_URI</code> from the referenced CAM configuration <strong>before starting the new operation</strong>. At the hosting pause, host the printed files and repeat the same command, choosing Resume and entering their URI. A configured URI can skip the pause; ensure those bytes are hosted before approving publication.</p>
<p>To deploy a projection candidate <em>without</em> changing the app, use <code>release/ui/deploy</code> instead. Its saved artifact can be selected later; deployment alone changes no root reference. Separate projection-deployer and CAM-owner configurations are described in <a href="../reference/operations.html#configuration">operation inputs</a>.</p>
<h2 id="check">Check the new publication</h2>
<pre><code>make pay-to-play/release/verify DOCKER_CONTEXT="$CTX" INSTANCE="$INSTANCE" &amp;&amp;
make viewer/release/up DOCKER_CONTEXT="$CTX" INSTANCE="$INSTANCE"</code></pre>
<p>Select the completed publication and open a fresh session. Refreshing a screen's read does not reload publication resources. Inspect the chain, root, resource integrity, intended bindings and a known task. For the Pay-to-Play navigation update, check all six destinations and that the balances/keys belong to the same intended payment contract.</p>
<p>Historical record verification does not prove current ownership or every critical action. Test the intended authorities and app behavior before accepting the cutover. Stop this local viewer with <code>viewer/release/down</code>; permanent server hosting has its <a href="../viewer/deploy.html">own lifecycle</a>.</p>
<h2 id="migration">Business replacement needs a migration decision</h2>
<p>A new business contract has a new address and state. Pay-to-Play vouchers bind the verifying-contract address; changing an ABI or manifest cannot move deposits, permanent keys or signatures. Specify the client/state transition and treatment of the old instance before deploying a replacement.</p>
<h2 id="recover">Recover or reverse deliberately</h2>
<p>Keep failed attempts and <a href="recovery.html">resume the selected operation</a>. Resolve uncertain submissions before approving another creation. Restoring an earlier CAM publication is itself an authorized on-chain update and may be incompatible with subsequent changes; rolling back a viewer image does not perform that reversal.</p>

</div>
