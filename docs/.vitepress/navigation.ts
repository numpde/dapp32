// Single UI projection of architecture.json. A page has one owner and a
// sidebar describes only destinations within that owner's section.
import architecture from './architecture.json'
import deploymentCatalog from '../public/gallery/deployments.json'

export type Page = { source: string; route: string; text: string }
type PagesGroup = { kind: 'pages'; title: string; parent?: string; collapsed?: boolean; pages: Page[] }
type CatalogGroup = { kind: 'catalog'; title: string; catalog: string; anchor: string }
type Group = PagesGroup | CatalogGroup
type Section = { id: string; label: string; landing: Page; groups: Group[] }
type Crumb = { text: string; href?: string }
const sections = architecture.sections as Section[]

export function pageLink(route: string): string {
  return route.endsWith('/index.md')
    ? '/' + route.slice(0, -'index.md'.length)
    : '/' + route.replace(/\.md$/, '.html')
}
export const pages = sections.flatMap(section => [
  section.landing, ...section.groups.flatMap(group => group.kind === 'pages' ? group.pages : []),
])

function catalogItems(section: Section, group: CatalogGroup) {
  if (section.id !== 'gallery' || group.catalog !== 'gallery/deployments.json'
      || group.anchor !== 'appId') {
    throw new Error('Unsupported sidebar collection: ' + group.catalog)
  }
  const names = new Map<string, string>()
  for (const deployment of deploymentCatalog.deployments) {
    const id = deployment.appId
    if (!/^[a-z][a-z0-9-]*$/.test(id)) throw new Error('Invalid deployed application ID: ' + id)
    if (names.has(id) && names.get(id) !== deployment.name) {
      throw new Error('Conflicting deployed application names for ' + id)
    }
    names.set(id, deployment.name)
  }
  return [...names].sort((a, b) => a[0].localeCompare(b[0]))
    .map(([id, name]) => ({ text: name, link: '/' + section.id + '/#' + id }))
}

function sidebarGroup(section: Section, group: Group) {
  const items = group.kind === 'pages'
    ? group.pages.map(page => ({ text: page.text, link: pageLink(page.route) }))
    : catalogItems(section, group)
  return { text: group.title, collapsed: group.kind === 'pages' ? group.collapsed ?? false : false, items }
}

export const rewrites = Object.fromEntries(pages
  .filter(page => page.source !== page.route)
  .map(page => [page.source, page.route]))

export const nav = sections.map(section => ({
  text: section.label,
  link: pageLink(section.landing.route),
  activeMatch: '^/' + section.id + '/',
}))

export const sidebar = Object.fromEntries(sections.map(section => [
  pageLink(section.landing.route),
  section.groups.map(group => sidebarGroup(section, group)),
]))

// Root links are the top navigation's job; they are not repeated as children.
// Breadcrumb parents must be real authored pages, never a category title.
export function breadcrumbsFor(relativePath: string): Crumb[] {
  if (relativePath === 'index.md') return []
  for (const section of sections) {
    if ([section.landing.source, section.landing.route].includes(relativePath)) return []
    for (const group of section.groups) {
      if (group.kind !== 'pages') continue
      const current = group.pages.find(page => page.source === relativePath || page.route === relativePath)
      if (!current) continue
      const trail: Crumb[] = [
        { text: 'Home', href: '/' },
        { text: section.label, href: pageLink(section.landing.route) },
      ]
      if (group.parent && group.parent !== section.landing.source && group.parent !== current.source) {
        const parent = group.pages.find(page => page.source === group.parent)
        if (!parent) throw new Error('Unowned breadcrumb parent ' + group.parent)
        trail.push({ text: parent.text, href: pageLink(parent.route) })
      }
      trail.push({ text: current.text })
      return trail
    }
  }
  return []
}
