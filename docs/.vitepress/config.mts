import { defineConfig } from 'vitepress'
import architecture from './architecture.json'

type Page = { source: string; route: string; text: string }
type Group = { title: string; collapsed?: boolean; parent?: string; pages: Page[] }
type Section = { id: string; label: string; groups: Group[] }
const sections = architecture.sections as Section[]

const pageLink = (route: string): string => route.endsWith('/index.md')
  ? '/' + route.slice(0, -'index.md'.length)
  : '/' + route.replace(/\.md$/, '.html')

const rewrites = Object.fromEntries(
  sections.flatMap(section => section.groups.flatMap(group => group.pages))
    .filter(page => page.source !== page.route)
    .map(page => [page.source, page.route])
)

const nav = sections.map(section => ({
  text: section.label,
  link: '/' + section.id + '/',
  activeMatch: '^/' + section.id + '/',
}))

// Each canonical URL belongs to exactly one section. Sidebar groups are
// navigational clusters, not additional parent pages or competing trees.
const sidebar = Object.fromEntries(sections.filter(section => section.id !== 'gallery').map(section => [
  '/' + section.id + '/',
  section.groups.map(group => ({
    text: group.title,
    collapsed: group.collapsed ?? false,
    items: group.pages.map(page => ({ text: page.text, link: pageLink(page.route) })),
  })),
]))

export default defineConfig({
  lang: 'en-US',
  title: 'dapp32',
  description: 'Contract-defined applications, viewers, and workflows.',
  base: '/dapp32/',
  cleanUrls: false,
  lastUpdated: false,
  rewrites,
  themeConfig: {
    siteTitle: 'dapp32',
    nav,
    sidebar,
    search: { provider: 'local' },
    outline: { level: [2, 3] },
    editLink: {
      pattern: 'https://github.com/numpde/dapp32/edit/main/docs/:path',
      text: 'Edit this page on GitHub',
    },
  },
})
