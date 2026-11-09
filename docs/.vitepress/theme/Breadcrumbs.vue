<script setup lang="ts">
import { computed } from 'vue'
import { useData, withBase } from 'vitepress'
import architecture from '../architecture.json'

type Page = { source: string; route: string; text: string }
type Group = { parent?: string; pages: Page[] }
type Section = { id: string; label: string; groups: Group[] }
type Crumb = { text: string; href?: string }

const { page } = useData()
const sections = architecture.sections as Section[]
const canonical = (route: string) => route.endsWith('/index.md')
  ? '/' + route.slice(0, -'index.md'.length)
  : '/' + route.replace(/\.md$/, '.html')

// A breadcrumb ancestor must be an actual linked page, not a category label.
// The same inventory controls this component, the global menu and the sidebar.
const trail = computed((): Crumb[] => {
  const source = page.value.relativePath
  if (source === 'index.md') return []

  for (const section of sections) {
    for (const group of section.groups) {
      const current = group.pages.find(item => item.source === source)
      if (!current || section.id === 'gallery') continue

      const sectionHome = section.groups
        .flatMap(candidate => candidate.pages)
        .find(item => item.route === section.id + '/index.md')
      if (!sectionHome || sectionHome.source === source) return []

      const crumbs: Crumb[] = [
        { text: 'Home', href: withBase('/') },
        { text: section.label, href: withBase(canonical(sectionHome.route)) },
      ]
      if (group.parent && group.parent !== source && group.parent !== sectionHome.source) {
        const parent = group.pages.find(item => item.source === group.parent)
        if (parent) crumbs.push({ text: parent.text, href: withBase(canonical(parent.route)) })
      }
      crumbs.push({ text: current.text })
      return crumbs
    }
  }
  return []
})
</script>

<template>
  <nav v-if="trail.length" class="doc-breadcrumb" aria-label="Breadcrumb">
    <ol>
      <li v-for="(crumb, index) in trail" :key="index">
        <a v-if="crumb.href" :href="crumb.href">{{ crumb.text }}</a>
        <span v-else aria-current="page">{{ crumb.text }}</span>
      </li>
    </ol>
  </nav>
</template>
