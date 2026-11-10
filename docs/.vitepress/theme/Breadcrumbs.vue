<script setup lang="ts">
import { computed } from 'vue'
import { useData, withBase } from 'vitepress'
import { breadcrumbsFor } from '../navigation'

const { page } = useData()
const trail = computed(() => breadcrumbsFor(page.value.relativePath))
</script>

<template>
  <nav v-if="trail.length" class="doc-breadcrumb" aria-label="Breadcrumb">
    <ol>
      <li v-for="(crumb, index) in trail" :key="index">
        <a v-if="crumb.href" :href="withBase(crumb.href)">{{ crumb.text }}</a>
        <span v-else aria-current="page">{{ crumb.text }}</span>
      </li>
    </ol>
  </nav>
</template>
