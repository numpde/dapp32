---
title: Gallery
description: Browse deployed apps, choose a release, and open its viewer.
sidebar: false
outline: false
---

<script setup>
import { onMounted, onBeforeUnmount } from 'vue'

let dispose
let alive = false

onMounted(async () => {
  alive = true
  const { mountGallery } = await import('./deployments.js')
  if (alive) dispose = mountGallery()
})

onBeforeUnmount(() => {
  alive = false
  dispose?.()
})
</script>

# Gallery

<div class="ported-guide gallery-content">

<p class="lede">Browse deployed apps. Select a release and open it in the stand-alone viewer or the newer Pages preview. These public instances run on test networks.</p>
    
<p id="load-status" role="status">Loading deployments…</p>
<button id="retry" class="button" type="button" hidden>Retry loading</button>
<div id="deployments" class="deployment-list"></div>
<noscript><p>Enable JavaScript to show the deployments, or open the <a href="deployments.json">deployment data</a>.</p></noscript>
<p class="sources">Sources: <a href="deployments.json">deployment data</a> · <a href="../deployment/networks/">RPC network catalog</a>.</p>

</div>
