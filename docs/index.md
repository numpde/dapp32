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

<p>A typical dapp32 application involves four distinct components, although only three are specific to the application.</p>

<table>
<thead><tr><th>Component</th><th>Location</th><th>Application-specific?</th><th>Responsibility</th></tr></thead>
<tbody>
<tr><td><strong>Business contracts</strong></td><td>On-chain</td><td>Yes</td><td>Implement business logic, maintain state, enforce permissions, and execute transactions.</td></tr>
<tr><td><strong>CAM root contract</strong></td><td>On-chain</td><td>Yes</td><td>Publishes a reference to the application's CAM and resolves named contract addresses.</td></tr>
<tr><td><strong>Contract Application Manifest (CAM)</strong></td><td>Off-chain</td><td>Yes</td><td>Describes the application's workflows, contract interactions, screens, forms, and actions.</td></tr>
<tr><td><strong>Standard viewer</strong></td><td>Off-chain</td><td>No</td><td>Interprets the CAM, renders the application, reads contract state, and prepares transactions.</td></tr>
</tbody>
</table>

<p>There is also an optional on-chain <strong>UI projection contract</strong>. For example, <code>CamEscrowUI</code> assembles contract state into information suitable for display. It does not define the interface or authorize transactions.</p>

<h2>The important distinctions</h2>

<p><strong>The CAM root does not define the UI.</strong> It identifies the application's contracts and publishes the location and digest of the CAM. It is an on-chain publication and discovery mechanism, not a web host.</p>

<p><strong>The CAM is not itself a smart contract.</strong> It consists of off-chain files, including:</p>
<ul>
<li><code>main.json</code>: workflows, routes, and contract reads and writes.</li>
<li><code>ui.json</code>: screens, controls, forms, and presentation definitions.</li>
<li>ABI and protocol resources: the interfaces and conventions needed to interpret those operations.</li>
</ul>

<p><strong>The viewer is not specific to the application.</strong> The same software interprets different CAMs. An autonomous agent can interpret a CAM without using the graphical viewer.</p>

<h2>How they fit together</h2>

<p><strong>Opening an application:</strong><br>Viewer → CAM root → CAM → contract reads → rendered interface.</p>
<p><strong>Executing an action:</strong><br>Interface → prepared transaction → wallet approval → business contract.</p>
<p>The business contracts remain authoritative throughout.</p>

<p>A dapp32 application therefore has three application-specific components: business contracts, a CAM root contract, and an off-chain CAM. The standard viewer is shared infrastructure. A developer can publish another application without writing a separate frontend for it.</p>

<p>This repository demonstrates the approach end to end with three applications: Pay-to-Play, Escrow, and Bike NFT.</p>
<section id="documentation">
<HomeSections />
</section>

</div>
