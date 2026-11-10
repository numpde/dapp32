import { defineConfig } from 'vitepress'
import architecture from './architecture.json'
import galleryCatalog from '../public/gallery/deployments.json'

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
const sidebar = Object.fromEntries(sections.map(section => [
  '/' + section.id + '/',
  section.groups.map(group => ({
    text: group.title,
    collapsed: group.collapsed ?? false,
    items: group.pages.map(page => ({ text: page.text, link: pageLink(page.route) })),
  })),
]))


// Sidebar entries point to actual deployed apps, derived from the same catalog
// that renders the Gallery; they are anchored sections, not duplicate guide owners.
const deployedApps = new Map<string, string>()
for (const app of galleryCatalog.deployments) {
  if (!/^[a-z][a-z0-9-]*$/.test(app.appId)) throw new Error('Invalid Gallery application ID')
  if (deployedApps.has(app.appId) && deployedApps.get(app.appId) !== app.name) {
    throw new Error('Conflicting Gallery application names for ' + app.appId)
  }
  deployedApps.set(app.appId, app.name)
}
// The Gallery is a directory, not a nested guide tree. Flat links keep the
// same sidebar as the other sections without meaningless disclosure toggles.
// Releases are chosen in the Gallery card, not duplicated in the sidebar.
sidebar['/gallery/'] = [
  { text: 'Browse deployments', link: '/gallery/' },
  ...[...deployedApps].sort((a, b) => a[1].localeCompare(b[1]))
    .map(([id, name]) => ({ text: name, link: '/gallery/#' + id })),
  { text: 'Open an unlisted app', link: '/use/' },
  { text: 'Try a local demo', link: '/start/examples/' },
  { text: 'Network catalog', link: '/deploy/networks/' },
]

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
