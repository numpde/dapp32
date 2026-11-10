import { defineConfig } from 'vitepress'
import { nav, sidebar, rewrites } from './navigation'

// All navigation and canonical routes are compiled from architecture.json.
// Do not append per-section links here: cross-section links belong in content.
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
