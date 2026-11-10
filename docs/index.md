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

<p>A typical dapp32 application consists of:</p>
<ul>
<li>Smart contracts on the blockchain that implement the application's business logic.</li>
<li>A separate on-chain <strong>CAM root contract</strong> that points to an off-chain Contract Application Manifest (CAM) and identifies the application's contract addresses.</li>
<li>A standard, off-chain viewer that reads the CAM and renders an interface for the application.</li>
</ul>
<p>The CAM is a standardized description of contract workflows. It connects low-level on-chain operations to screens and actions without requiring a custom frontend. The same description can be interpreted by the standard viewer or by autonomous agents, so developers can build and publish applications without implementing a separate frontend for each one.</p>
<p>This repository demonstrates the approach end to end with three concrete applications: Pay-to-Play, Escrow, and Bike NFT.</p>
<section id="documentation">
<HomeSections />
</section>

</div>
