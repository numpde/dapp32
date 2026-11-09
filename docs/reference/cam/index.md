---
title: "CAM reference versions"
description: ""
outline: false
---

# CAM reference

<div class="ported-guide">


<p>Use <a href="1.4.0/">CAM 1.4.0 with UI 1.1.0</a> for the current implementation. This is an experimental format. Earlier versions below document historical behavior; current software does not accept their manifests.</p>
<p>The current host returns a manifest URI and a <strong>SHA-256 digest of its exact bytes</strong> through <code>camManifest()</code>. The manifest also pins its protocol, ABI and UI resources. Do not use the older Keccak-256 manifest convention.</p>
<h2>Which reference do I need?</h2>
<ul><li><a href="1.4.0/#bootstrap">Discover and authenticate an application</a>.</li><li><a href="1.4.0/#graph">Interpret routes and namespaces</a>.</li><li><a href="1.4.0/#ui">Interpret the UI vocabulary</a>.</li><li><a href="1.4.0/#viewer-integrity">Understand the viewer's integrity warnings</a>.</li><li><a href="../../authoring/">Build a workflow with the worked guide</a>.</li></ul>
<h2>Historical specifications</h2>
<ul><li><a href="1.3.0/">CAM 1.3.0 / UI 1.0.0</a></li><li><a href="1.2.0/">CAM 1.2.0 / UI 1.0.0</a></li><li><a href="1.1.0/">CAM 1.1.0 / UI 1.0.0</a></li></ul>
<h2>Source ownership</h2>
<p>The published 1.4.0 document is an exact copy of <code>docs/reference/cam/1.4.0/index.html</code> in source revision <a href="https://github.com/numpde/dapp32/tree/04a18763700bbaa25cad73b9806d236ab4d5e139">04a18763</a>. CAM bundles use those same reference bytes as <code>protocol.html</code>. Edit the source owner and refresh affected bundle digests when changing that reference; do not independently rewrite or restyle the published copy.</p>

</div>
