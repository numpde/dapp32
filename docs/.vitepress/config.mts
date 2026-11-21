import { defineConfig } from 'vitepress'
import { existsSync, readdirSync } from 'node:fs'
import { nav, sidebar, rewrites, pages, pageLink } from './navigation'

const base = '/dapp32/'
const suppliedURL = process.env.DOCS_PUBLIC_URL
if (!suppliedURL) throw new Error('Set DOCS_PUBLIC_URL to the html_url returned by the GitHub Pages API')
const publicURL = new URL(suppliedURL)
if (publicURL.protocol !== 'https:' || publicURL.username || publicURL.password
    || publicURL.search || publicURL.hash || publicURL.pathname !== base) {
  throw new Error('DOCS_PUBLIC_URL must be an HTTPS site URL using the supported /dapp32/ layout, without credentials, query or fragment')
}

const referenceRoot = new URL('../reference/cam/', import.meta.url)
const references = readdirSync(referenceRoot, { withFileTypes: true })
  .filter(entry => entry.isDirectory() && existsSync(new URL(`${entry.name}/index.html`, referenceRoot)))
  .map(entry => `reference/cam/${entry.name}/`)
  .sort()
const canonicalRoutes = new Set(pages.map(page => pageLink(page.route).slice(1)))

// All navigation and canonical routes are compiled from architecture.json.
// Do not append per-section links here: cross-section links belong in content.
export default defineConfig({
  lang: 'en-US',
  title: 'dapp32',
  description: 'Contract-defined applications, viewers, and workflows.',
  base,
  cleanUrls: false,
  lastUpdated: false,
  rewrites,
  sitemap: {
    hostname: publicURL.href,
    transformItems: items => [
      ...items.filter(item => canonicalRoutes.has(item.url)),
      ...references.map(url => ({ url })),
    ],
  },
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
