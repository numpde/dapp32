---
title: "How a dapp32 application runs"
description: "Follow discovery, contract reads, transaction preparation, wallet approval, and execution."
outline: false
---

# How a dapp32 application runs

<div class="ported-guide">

<p>The <a href="../">homepage</a> describes the business contracts, CAM root, off-chain CAM, and shared viewer. This page follows what happens when someone opens an application and executes an action. The CAM root is an on-chain contract; the CAM files are served separately.</p>

<h2>Opening an application</h2>

<ol>
<li><strong>Select the chain and CAM root address.</strong> Choose a published instance in the <a href="../gallery/">Gallery</a>, or enter the chain and CAM root in a viewer. The viewer uses RPC to query the CAM root contract.</li>
<li><strong>Load the CAM.</strong> The root returns the manifest's URI and byte digest, and resolves named contract addresses. The viewer fetches the manifest from its off-chain location, then fetches its referenced UI, ABI, and protocol resources. These files are not stored in the root contract.</li>
<li><strong>Interpret the workflow.</strong> The CAM defines routes, contract calls, and screens. The standard viewer renders those screens; a compatible agent can interpret the same CAM without a graphical interface. Neither needs a dedicated frontend for this application.</li>
<li><strong>Read state.</strong> Through RPC, the viewer calls the contracts identified by the CAM root. An application may also use an optional read-only UI projection contract to assemble information for a screen. The viewer displays the returned data and available actions.</li>
</ol>

<p>Opening an app requires a usable RPC endpoint and browser access to the hosted CAM resources. Merely opening or reading it does not require the user to sign a transaction. Choosing a viewing address does not grant authority to act as that address.</p>

<h2>Executing an action</h2>

<p>For example, consider depositing money into a Pay-to-Play payment channel:</p>

<ol>
<li>The user enters an amount in the viewer. The form holds a local draft; no transaction has been sent.</li>
<li>The CAM route tells the viewer which contract function to call and how to form its arguments and native value. The viewer prepares the transaction and may simulate it.</li>
<li>The user reviews the destination, network, arguments, and amount, then authorizes the transaction through a wallet.</li>
<li>The business contract executes the call and checks the real sender, supplied value, current state, and its own rules. The CAM and viewer cannot bypass those checks.</li>
<li>A successful transaction receipt establishes execution. The viewer rereads the resulting contract state to display the updated balance or status.</li>
</ol>

<p>Simulation can become stale between preparation and submission. A transaction hash alone is not evidence of successful execution; check the receipt. For a disposable example, use the <a href="local-wallet.html">local-wallet walkthrough</a>.</p>

<h2>What can change independently</h2>

<ul>
<li><strong>CAM files:</strong> Changing a screen, label, or workflow description changes the interface without changing the business contracts. The changed resources must be published and referenced by an updated CAM publication.</li>
<li><strong>CAM root:</strong> Changing its published manifest reference or named address bindings changes what clients discover; it does not migrate business-contract state.</li>
<li><strong>Viewer:</strong> Updating the standard viewer changes the client software, not the published CAM or on-chain contracts.</li>
<li><strong>UI projection contract:</strong> An optional read-only contract can assemble state for display. It does not authorize transactions or define the screen layout.</li>
</ul>

<h2>What publication proves</h2>

<p>The current format uses SHA-256 digests of the manifest and referenced resources. Matching digests show that fetched bytes agree with a particular CAM publication; they do not establish that the publisher, contract code, RPC endpoint, or application is trustworthy. Named address bindings can change independently of the manifest.</p>

<p>The viewer can continue after an integrity warning. Treat it as an unresolved warning, not proof that the application is safe. Before signing, verify the selected chain, destination contract, function, arguments, and amount. The <a href="../reference/cam/1.4.0/#security">CAM trust-boundary reference</a> specifies the exact behavior.</p>

</div>
