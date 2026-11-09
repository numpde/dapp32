---
title: "Use Bike NFT"
description: "Look up or register a component, manage its metadata and reports, and hand over its NFT or authorize a workshop."
outline: false
---

# Use Bike NFT

<div class="ported-guide">


<p id="what">An authorized registrar records a component's serial and mints its ERC-721 token to an owner. The owner can maintain its record, grant limited workshop access or transfer the NFT. The contract does not inspect the physical component or prove its authenticity.</p>
<nav id="workflow" aria-label="Guide sections"><a href="#lookup">Look up</a> · <a href="#register">Register</a> · <a href="metadata.html">Metadata</a> · <a href="ownership.html">Handover and workshops</a> · <a href="#reports">Reports</a> · <a href="#try">Try locally</a></nav>
<h2 id="lookup">Find the component before acting</h2>
<p><a href="../use/">Open the intended chain and CAM host</a>. Enter the exact serial, including case and spaces, and choose <strong>Look up component</strong>. Check its owner, collection, token ID, service state and missing-report state.</p>
<p>Editing the search input does not change the displayed loaded component or the target of its actions. Look up the new serial first. Connect the intended wallet and let the view refresh before preparing a write.</p>
<h2 id="register">Register an unused serial</h2>
<ol>
<li>Connect a wallet with the manager's registrar role. Choose <strong>Check registration</strong> for the unused serial.</li>
<li>Enter the initial owner's address. It can differ from the registrar. Prepare the token document using <a href="metadata.html">the metadata guide</a>, including its collection-base check.</li>
<li>Choose <strong>Register component</strong>, review and send. After a successful receipt, check the loaded record and NFT owner.</li>
</ol>
<p>The serial determines the token ID from its hash; it is not a short human identifier or a metadata digest. Losing registrar authority removes permission to create records, not ownership of existing NFTs.</p>
<h2 id="authority">Choose the right authority</h2>
<table><thead><tr><th>Task</th><th>Who can authorize it?</th></tr></thead><tbody>
<tr><td>Register</td><td>A manager-authorized registrar.</td></tr>
<tr><td>Change metadata or manage a missing report</td><td>The owner or a workshop with that specific live capability.</td></tr>
<tr><td>Take out of service, reactivate or manage grants</td><td>The current token owner.</td></tr>
<tr><td>Handover through the app</td><td>The current owner, through a direct NFT transfer.</td></tr>
</tbody></table>
<p><a href="ownership.html">Hand over ownership or authorize a workshop</a> explains expiry, replacement presets and transfer invalidation. These grants are not NFT transfer approvals. Account profile information is separately self-managed by its account and grants no registry authority.</p>
<h2 id="reports">Missing reports and service state</h2>
<p>Use <strong>Report component missing</strong> with a nonempty published report URI. Resolve it with <strong>Resolve missing report</strong> and a resolution URI. These are public references, not encrypted private messages or proof of an investigation.</p>
<p><strong>Take out of service</strong> and <strong>Reactivate</strong> change a separate owner-controlled lifecycle flag. Neither opens, resolves nor erases a missing report. Current contracts still allow metadata corrections and ordinary token transfers in either service state; older irreversible retirement contracts retain their old behavior.</p>
<h2 id="try">Try locally</h2>
<p>After <a href="../development/">source setup</a>, start:</p>
<pre><code>make bike-nft/local/demo/gui/up \
  DOCKER_CONTEXT=your-local-context COMPOSE_PROJECT_NAME=cam-demo</code></pre>
<p>Keep it running and open the complete printed URL, normally on loopback port 5173. Read <code>DEMO-FRAME-001</code>, <code>DEMO-BATTERY-001</code>, <code>DEMO-MOTOR-001</code> or <code>DEMO-BIKE-001</code> without a wallet. Choose <strong>Load preview</strong> to inspect its metadata.</p>
<p>Follow <a href="../start/fixture-wallet.html">Attach a local test wallet</a> using <code>FIXTURE_WALLET_APP=bike-nft</code> and the same context/project. Its seller, mechanic and buyer are public fixture identities; the latter two need local gas before sending. Practice registration with a new serial, not an already seeded one.</p>
<p>Detach the wallet, stop the launcher and let cleanup finish. The explicit matching cleanup is:</p>
<pre><code>make bike-nft/local/demo/gui/down \
  DOCKER_CONTEXT=your-local-context COMPOSE_PROJECT_NAME=cam-demo</code></pre>
<p>The current fixture pins SHA-256 of the exact CAM manifest bytes. That local result does not qualify a public deployment. Closing a browser tab alone does not stop the fixture or erase its state.</p>
<h2 id="contracts">Know which contract owns the action</h2>
<p><code>BicycleComponents</code> owns the ERC-721 tokens. <code>BicycleComponentManager</code> owns registry actions and workshop grants. The read-only projection returns screen data; <code>CamRoot</code> publishes resources and contract bindings. The viewer submits calls to those actual destinations.</p>
<p id="boundaries">Manager pause and collection pause are separate. A paused manager blocks its registry writes, not direct token transfers; a paused collection blocks transfers. A manifest label, preview or enabled control is not authorization: inspect the actual call and wait for its receipt.</p>
<h2 id="deployment">Deploy or accept administration</h2>
<p>Use <a href="../deployment/bike-nft/">Bike deployment settings</a> with the <a href="../deployment/new-instance.html">shared release procedure</a>. For a pending nominee, open <strong>Deployment handovers</strong>, connect the nominated wallet and check the specific contract and acceptance time. CAM ownership and the two delayed administrator handovers are independent.</p>
<p>Source baseline: <a href="https://github.com/numpde/dapp32/tree/04a18763700bbaa25cad73b9806d236ab4d5e139/dapps/bike-nft">04a18763</a>. This page changes no older deployment's permissions, metadata-prefix policy or retirement semantics.</p>
<h2 id="cam">CAM route reference</h2>
<p>The table is checked against the committed manifest. Read routes supply screens; write routes prepare calls and continue after successful execution.</p>
<details><summary>Show route calls and continuations</summary><div class="route-table">
        <table data-check="bike-routes">
          <thead>
            <tr>
              <th>Route</th>
              <th>Kind</th>
              <th>Contract function</th>
              <th>Continuation</th>
              <th>User-facing purpose</th>
            </tr>
          </thead>
          <tbody>
<tr><td><code>deploymentHandovers</code></td><td>read</td><td><code>viewDeploymentHandovers(camHost, account)</code></td><td><code>ui.app(view={'screen': 'deploymentHandovers', 'task': {'paused': '$outputs.0.paused', 'componentTokenPaused': '$outputs.0.componentTokenPaused', 'cam': '$outputs.0.cam', 'components': '$outputs.0.components', 'manager': '$outputs.0.manager', 'actions': '$outputs.0.actions', 'navigationSerial': ''}, 'navigationSerial': '', 'navigation': 'navigation'})</code></td><td>Inspect independent CAM ownership and Components/Manager administrator handovers.</td></tr>
<tr><td><code>acceptCamOwnership</code></td><td>write</td><td><code>acceptOwnership()</code></td><td><code>routes.deploymentHandoversWithContext(serialNumber=$inputs.serialNumber)</code></td><td>The nominated owner accepts ownership directly on the selected CAM host.</td></tr>
<tr><td><code>acceptComponentsAdmin</code></td><td>write</td><td><code>acceptDefaultAdminTransfer()</code></td><td><code>routes.deploymentHandoversWithContext(serialNumber=$inputs.serialNumber)</code></td><td>The nominated Components administrator accepts after its chain-time delay.</td></tr>
<tr><td><code>acceptManagerAdmin</code></td><td>write</td><td><code>acceptDefaultAdminTransfer()</code></td><td><code>routes.deploymentHandoversWithContext(serialNumber=$inputs.serialNumber)</code></td><td>The nominated Manager administrator accepts after its chain-time delay.</td></tr>
<tr><td><code>findComponentForm</code></td><td>read</td><td><code>viewEntry(account)</code></td><td><code>ui.app(view={'screen': 'entry', 'task': {'serialNumber': '$inputs.serialNumber', 'actions': '$outputs.0.actions', 'paused': '$outputs.0.paused', 'componentTokenPaused': '$outputs.0.componentTokenPaused', 'account': '$outputs.0.account', 'canRegister': '$outputs.0.canRegister', 'accountInfo': '$outputs.0.accountInfo'}, 'navigationSerial': '$inputs.serialNumber', 'navigation': 'navigation.find'})</code></td><td>Return to component search with the selected serial.</td></tr>
<tr><td><code>deploymentHandoversWithContext</code></td><td>read</td><td><code>viewDeploymentHandovers(camHost, account)</code></td><td><code>ui.app(view={'screen': 'deploymentHandovers', 'task': {'paused': '$outputs.0.paused', 'componentTokenPaused': '$outputs.0.componentTokenPaused', 'cam': '$outputs.0.cam', 'components': '$outputs.0.components', 'manager': '$outputs.0.manager', 'actions': '$outputs.0.actions', 'navigationSerial': '$inputs.serialNumber'}, 'navigationSerial': '$inputs.serialNumber', 'navigation': 'navigation'})</code></td><td>Inspect deployment handovers while retaining the selected serial.</td></tr>
<tr><td><code>entry</code></td><td>read</td><td><code>viewEntry(account)</code></td><td><code>ui.app(view={'screen': '$outputs.0.viewId', 'task': '$outputs.0', 'navigationSerial': '', 'navigation': 'navigation.find'})</code></td><td>Look up a component or edit the viewed account’s profile.</td></tr>
<tr><td><code>component</code></td><td>read</td><td><code>viewComponent(serialNumber, account)</code></td><td><code>ui.app(view={'screen': '$outputs.0.viewId', 'task': '$outputs.0', 'navigationSerial': '$inputs.serialNumber', 'navigation': 'navigation'})</code></td><td>Read one component and its available actions.</td></tr>
<tr><td><code>register</code></td><td>read</td><td><code>viewRegister(serialNumber, account)</code></td><td><code>ui.app(view={'screen': '$outputs.0.viewId', 'task': '$outputs.0', 'navigationSerial': '$inputs.serialNumber', 'navigation': 'navigation'})</code></td><td>Check whether a serial can be registered.</td></tr>
<tr><td><code>registerComponent</code></td><td>write</td><td><code>registerComponent(owner, serialNumber, tokenURI_)</code></td><td><code>routes.component(serialNumber=$inputs.serialNumber)</code></td><td>Mint the component NFT and register its serial.</td></tr>
<tr><td><code>setAccountInfo</code></td><td>write</td><td><code>setAccountInfo(infoURI)</code></td><td><code>routes.findComponentForm(serialNumber=$inputs.serialNumber)</code></td><td>Set the sending account’s public information URI.</td></tr>
<tr><td><code>updateComponentMetadata</code></td><td>write</td><td><code>setComponentMetadata(serialNumber, tokenURI_)</code></td><td><code>routes.component(serialNumber=$inputs.serialNumber)</code></td><td>Update the component NFT’s metadata URI.</td></tr>
<tr><td><code>markComponentMissing</code></td><td>write</td><td><code>markComponentMissing(serialNumber, reportURI)</code></td><td><code>routes.component(serialNumber=$inputs.serialNumber)</code></td><td>Open a missing report with its published URI.</td></tr>
<tr><td><code>clearComponentMissing</code></td><td>write</td><td><code>clearComponentMissing(serialNumber, resolutionURI)</code></td><td><code>routes.component(serialNumber=$inputs.serialNumber)</code></td><td>Resolve the missing report with a resolution URI.</td></tr>
<tr><td><code>decommissionComponent</code></td><td>write</td><td><code>decommissionComponent(serialNumber)</code></td><td><code>routes.component(serialNumber=$inputs.serialNumber)</code></td><td>Owner takes the component out of service without erasing missing reports.</td></tr>
<tr><td><code>reactivateComponent</code></td><td>write</td><td><code>reactivateComponent(serialNumber)</code></td><td><code>routes.component(serialNumber=$inputs.serialNumber)</code></td><td>Owner returns an out-of-service component to service.</td></tr>
<tr><td><code>delegation</code></td><td>read</td><td><code>viewDelegation(serialNumber, delegate, account, duration)</code></td><td><code>ui.app(view={'screen': '$outputs.0.viewId', 'task': '$outputs.0', 'navigationSerial': '$inputs.serialNumber', 'navigation': 'navigation'})</code></td><td>Inspect a workshop grant and preview its expiry.</td></tr>
<tr><td><code>setComponentDelegate</code></td><td>write</td><td><code>setComponentDelegate(serialNumber, delegate, capabilities, validUntil)</code></td><td><code>routes.component(serialNumber=$inputs.serialNumber)</code></td><td>Owner grants expiring, scoped workshop permissions.</td></tr>
<tr><td><code>revokeComponentDelegate</code></td><td>write</td><td><code>revokeComponentDelegate(serialNumber, delegate)</code></td><td><code>routes.component(serialNumber=$inputs.serialNumber)</code></td><td>Owner revokes workshop permissions.</td></tr>
<tr><td><code>transferComponent</code></td><td>write</td><td><code>safeTransferFrom(address,address,uint256)(from, to, tokenId)</code></td><td><code>routes.component(serialNumber=$inputs.serialNumber)</code></td><td>Owner transfers the NFT directly to its recipient.</td></tr>
</tbody>
        </table>
</div></details>

</div>
