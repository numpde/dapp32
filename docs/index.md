---
title: "What is dapp32?"
description: "Business contracts, a CAM root, an off-chain manifest, and a standard viewer."
outline: false
---

<script setup lang="ts">
import HomeSections from './.vitepress/theme/HomeSections.vue'
import architectureSvg from './.vitepress/theme/assets/dapp32-architecture.svg?raw'
</script>

# What is dapp32?

<div class="ported-guide">

<p>A typical dapp32 application has these components:</p>

<div class="table-scroll" role="region" aria-label="Components of a dapp32 application" tabindex="0">
<table class="component-table">
<thead><tr><th scope="col">Component</th><th scope="col">On-chain</th><th scope="col">App-specific</th><th scope="col">Responsibility</th></tr></thead>
<tbody>
<tr><th scope="row">Business contracts</th><td>Yes</td><td>Yes</td><td>Business logic, state, permissions, and transactions</td></tr>
<tr><th scope="row">Contract Application Manifest (CAM)</th><td>No</td><td>Yes</td><td>Describe workflows, contract interactions, views, forms, and actions</td></tr>
<tr><th scope="row">CAM root contract</th><td>Yes</td><td>Yes</td><td>Point to the CAM and resolve contracts by name</td></tr>
<tr><th scope="row">Standard viewer</th><td>No</td><td>No</td><td>Read contract state, interpret and render the CAM, prepare transactions</td></tr>
<tr><th scope="row">UI projection (optional)</th><td>Yes</td><td>Yes</td><td>Assemble contract state into useful information</td></tr>
</tbody>
</table>
</div>

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

<figure class="architecture-diagram">
  <div class="architecture-scroll" role="region" aria-label="dapp32 application architecture" tabindex="0" v-html="architectureSvg"></div>
</figure>

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
