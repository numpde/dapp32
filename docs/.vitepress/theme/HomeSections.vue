<script setup lang="ts">
import { withBase } from 'vitepress'
import { homeSections } from '../navigation'
</script>

<template>
  <!-- The root is the parent of all six sections. Their cards use the same
       labels, order, summaries and landing links as the top navigation. -->
  <div class="grid two" aria-label="Documentation sections">
    <section v-for="section in homeSections" :key="section.id"
             class="card home-section-card" :data-section="section.id">
      <h2><a :href="withBase(section.href)">{{ section.label }}</a></h2>
      <p>{{ section.summary }}</p>
    </section>
  </div>
</template>

<style scoped>
/* Card headings are navigation labels, not VitePress article section breaks. */
.home-section-card h2 {
  margin: 0;
  padding: 0;
  border: 0;
}
</style>
