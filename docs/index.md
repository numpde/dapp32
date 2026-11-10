---
title: "What is dapp32?"
description: "Business contracts, a CAM root, an off-chain manifest, and a standard viewer."
outline: false
---

<script setup lang="ts">
import HomeSections from './.vitepress/theme/HomeSections.vue'
</script>

# What is dapp32?

<div class="ported-guide">

<p>A typical dapp32 application has these components:</p>

<table>
<thead><tr><th></th><th>On-chain</th><th>App-specific</th><th>Responsibility</th></tr></thead>
<tbody>
<tr><td><strong>Business contracts</strong></td><td>✔</td><td>✔</td><td>Business logic, state, permissions, and transactions</td></tr>
<tr><td><strong>Contract Application Manifest (CAM)</strong></td><td>✗</td><td>✔</td><td>Describe workflows, contract interactions, views, forms, and actions</td></tr>
<tr><td><strong>CAM root contract</strong></td><td>✔</td><td>✔</td><td>Point to the CAM and resolve contracts by name</td></tr>
<tr><td><strong>Standard viewer</strong></td><td>✗</td><td>✗</td><td>Read contract state, interpret and render the CAM, prepare transactions</td></tr>
<tr><td><strong>UI projection (optional)</strong></td><td>✔</td><td>✔</td><td>Assemble contract state into useful information</td></tr>
</tbody>
</table>

<h2>Important distinctions</h2>

<p>
The CAM is a standardized description of contract workflows that positions itself 
between low-level on-chain operations and custom frontends. 
It can be read by both autonomous agents and the standard viewer (implemented in this repo), 
and allows developers to build and ship faster by providing functionality 
without the overhead of a custom frontend.
It consists of off-chain files, including:
</p>

<ul>
<li><code>main.json</code>: describes workflows, routes, and contract reads and writes;</li>
<li><code>ui.json</code>: contains forms, screens, controls, and presentation definitions;</li>
<li>ABI and protocol resources: the interfaces and conventions needed to interpret those operations.</li>
</ul>

<p>
The CAM root contract
is a publication and discovery mechanism.
It identifies the on-chain contracts by name 
and publishes the location and digest of the off-chain CAM. 
</p>


<p>
The viewer is <strong>not</strong> specific to the application. 
It is a standard frontend-only application that
can be self-hosted or not. 
</p>

<h2>How they fit together</h2>

<p><strong>Opening an application:</strong><br>Viewer → CAM root → CAM → contract reads → rendered interface.</p>
<p><strong>Executing an action:</strong><br>Interface → prepared transaction → wallet approval → business contract.</p>
<p>The business contracts remain authoritative throughout.</p>

<p>
This repository demonstrates 
this approach end to end with three applications:
</p>
<ul>
<li>Pay-to-Play as a blockchain payment system with cumulative voucher collection;</li>
<li>An Escrow service;</li>
<li>A Bike NFT on-chain registration database for bicycle components.</li>
</ul>

<h2>Where to go next</h2>

<section id="documentation">
<HomeSections />
</section>

</div>
