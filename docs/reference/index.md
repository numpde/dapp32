---
title: "Reference"
description: "Exact protocol rules, deployment record ownership and operational diagnostics, separate from task guides."
outline: false
---

# Reference

<div class="ported-guide">


<p>Look up exact rules here. To achieve a result, use <a href="../start/">Start</a>, <a href="../use/">Use</a>, <a href="../authoring/">Build</a> or <a href="../deployment/">Deploy</a>.</p>
<h2>Protocol</h2>
<dl>
<dt><a href="cam/1.4.0/">CAM 1.4.0 with UI 1.1.0</a></dt><dd>Discovery, SHA-256 resource identity, expressions, routes, UI elements and transaction execution. The published versioned file is copied byte-for-byte from its source owner.</dd>
<dt><a href="cam/">Version index</a></dt><dd>Current versus historical specifications. An older reference does not imply compatibility with the current reader.</dd>
</dl>
<h2>Operations</h2>
<dl>
<dt><a href="operations.html">Deployment records and authority</a></dt><dd>Private instances, defaults versus retained inputs, artifacts, approval images, Docker identity and nominee acceptance.</dd>
<dt><a href="diagnostics.html">Release diagnostics</a></dt><dd>Log meanings and limits, uncertain transaction outcomes, RPC deadlines and isolated simulation experiments.</dd>
<dt><a href="../deployment/networks/">Networks</a> and <a href="../deployment/rpc/">RPC services</a></dt><dd>Transport selection and provider configuration. A catalog entry does not authenticate a deployed contract.</dd>
<dt><a href="../deployment/rpc/#recorded-rpc-capabilities">Measured RPC capabilities</a></dt><dd>Dated, per-provider results for supported, rejected and inconclusive JSON-RPC methods. These observations are not service guarantees.</dd>
</dl>
<h2>App-specific behavior</h2>
<p><a href="../pay-to-play/#integrate">Pay-to-Play signing and integration</a> · <a href="../escrow/#phases">Escrow deadlines and settlement</a> · <a href="../escrow/documents.html">Escrow document commitments</a> · <a href="../bike-nft/#cam">Bike NFT routes</a>.</p>
<p>For a failed operation, start with <a href="../deployment/recovery.html">Recover an interrupted release</a> rather than retrying a creation. Source publication has its own <a href="../deployment/source-verification.html">verification and retry procedure</a>.</p>

## Documentation authoring

See [documentation authoring in the source-checkout guide](../development/#documentation-authoring).

</div>
