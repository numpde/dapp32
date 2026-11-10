---
title: "EVM networks and testnets"
description: ""
outline: false
---

<script setup>
import { onMounted, onBeforeUnmount } from 'vue'

let dispose
let alive = false

onMounted(async () => {
  alive = true
  const { mountNetworks } = await import('./networks.js')
  const cleanup = await mountNetworks()
  if (alive) dispose = cleanup
  else cleanup()
})

onBeforeUnmount(() => {
  alive = false
  dispose?.()
})
</script>


# EVM networks and their testnets

<div class="ported-guide network-page">


  <p class="intro">Select an ecosystem, then switch between its mainnet and application testnet. The same catalog supplies identifiers, endpoints, explorers and source references.</p>
  <noscript><p>Enable JavaScript to inspect networks from <a href="https://raw.githubusercontent.com/numpde/dapp32/main/js/packages/cam-viewer/src/rpc-catalog.json">the RPC catalog</a>.</p></noscript>
  <p id="load-status" role="status">Loading the RPC catalog…</p>
  <div id="reference" hidden>
    <div class="toolbar">
      <fieldset>
        <legend>Show</legend>
        <label><input type="radio" name="view" value="mainnet">Mainnets</label>
        <label><input type="radio" name="view" value="testnet" checked>Testnets</label>
      </fieldset>
      <div class="jump">
        <label for="network-jump">Network</label>
        <select id="network-jump"><option value="">Choose a network</option></select>
      </div>
    </div>
    <section id="networks" class="network-details"></section>
  </div>
  <footer>
    <p>A curated reference for widely used EVM ecosystems, including the networks discussed in this repository. Chain-specific execution, fees, and tooling can differ. Source-check dates describe documentation checks, not live RPC tests.</p>
    <p>Source: <a href="https://raw.githubusercontent.com/numpde/dapp32/main/js/packages/cam-viewer/src/rpc-catalog.json">js/packages/cam-viewer/src/rpc-catalog.json</a>. This page reads the catalog directly and keeps no separate network list. Endpoint selection for deployments is described in <a href="../rpc/">the RPC services guide</a>.</p>
    <p>Public RPC services can impose rate and method limits. Mainnet and testnet balances and deployments are separate. A retired testnet is retained for identification and has no selectable RPC service.</p>
  </footer>

</div>
