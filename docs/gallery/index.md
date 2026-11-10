---
title: Gallery
description: Browse deployed apps, choose a release, and open its viewer.
outline: false
---

<script setup>
import { onMounted, onBeforeUnmount } from 'vue'

let dispose
let alive = false
let importFailed = false
const retryImport = () => window.location.reload()

onMounted(async () => {
  alive = true
  try {
    const { mountGallery } = await import('./deployments.js')
    if (alive) dispose = mountGallery()
  } catch {
    if (!alive) return
    const status = document.querySelector('#load-status')
    const retry = document.querySelector('#retry')
    status?.classList.remove('is-loading')
    status?.setAttribute('aria-busy', 'false')
    status?.setAttribute('role', 'alert')
    if (status) status.textContent = 'Cannot load the Gallery. Reload to try again.'
    if (retry) {
      retry.hidden = false
      retry.addEventListener('click', retryImport)
      importFailed = true
    }
  }
})

onBeforeUnmount(() => {
  alive = false
  dispose?.()
  if (importFailed) document.querySelector('#retry')?.removeEventListener('click', retryImport)
})
</script>

# Gallery

<div class="ported-guide gallery-content">

<p class="lede">Browse deployed apps. Select a release and open it in the stand-alone viewer or the newer Pages preview. These public instances run on test networks.</p>
    
<p id="load-status" class="gallery-status is-loading" role="status" aria-live="polite" aria-busy="true">Loading deployments…</p>
<button id="retry" class="button" type="button" hidden>Retry loading</button>
<div id="deployments" class="deployment-list" aria-busy="true">
  <div class="gallery-loading-card" aria-hidden="true"><span class="gallery-loading-heading"></span><span class="gallery-loading-line"></span><span class="gallery-loading-line short"></span></div>
  <div class="gallery-loading-card" aria-hidden="true"><span class="gallery-loading-heading"></span><span class="gallery-loading-line"></span><span class="gallery-loading-line short"></span></div>
</div>
<noscript><p>Enable JavaScript to show the deployments, or open the <a href="deployments.json">deployment data</a>.</p></noscript>
<p class="sources">Related tasks: <a href="../use/">Open an unlisted app</a> · <a href="../examples/">Try a local demo</a> · <a href="../deployment/networks/">Network catalog</a>.</p>
<p class="sources">Data: <a href="deployments.json">deployment catalog</a>.</p>

</div>
