import { defineConfig } from 'vitepress'

export default defineConfig({
  lang: 'en-US',
  title: 'dapp32',
  description: 'Contract-defined applications, viewers, and workflows.',
  base: '/dapp32/',
  cleanUrls: false,
  lastUpdated: false,
  themeConfig: {
    siteTitle: 'dapp32',
    nav: [
      { text: 'Start', link: '/start/' },
      { text: 'Gallery', link: '/gallery/' },
      { text: 'Use', link: '/use/' },
      { text: 'Build', link: '/authoring/' },
      { text: 'Deploy', link: '/deployment/' },
      { text: 'Reference', link: '/reference/' },
    ],
    sidebar: {
      '/start/': [
        { text: 'Start here', items: [
          { text: 'How it works', link: '/start/' },
          { text: 'Try a local wallet', link: '/start/local-wallet.html' },
          { text: 'Attach the fixture wallet', link: '/start/fixture-wallet.html' },
          { text: 'Examples and demos', link: '/examples/' },
        ] },
      ],
      '/gallery/': false,
      '/use/': [
        { text: 'Use an app', items: [
          { text: 'Open an app', link: '/use/' },
          { text: 'Pay-to-Play', link: '/pay-to-play/' },
          { text: 'Escrow', link: '/escrow/' },
          { text: 'Bike NFT', link: '/bike-nft/' },
        ] },
      ],
      '/authoring/': [
        { text: 'Build a workflow', items: [
          { text: 'Authoring', link: '/authoring/' },
          { text: 'Headless integration', link: '/authoring/headless.html' },
          { text: 'Development setup', link: '/development/' },
          { text: 'Checks', link: '/development/app-checks.html' },
        ] },
      ],
      '/development/': [
        { text: 'Development', items: [
          { text: 'Setup', link: '/development/' },
          { text: 'App checks', link: '/development/app-checks.html' },
          { text: 'Payment fixture', link: '/development/payment-fixture.html' },
        ] },
      ],
      '/deployment/': [
        { text: 'Deploy', items: [
          { text: 'Choose a deployment task', link: '/deployment/' },
          { text: 'New app instance', link: '/deployment/new-instance.html' },
          { text: 'Update a publication', link: '/deployment/update.html' },
          { text: 'Recovery and cancellation', link: '/deployment/recovery.html' },
          { text: 'Source verification', link: '/deployment/source-verification.html' },
          { text: 'Practice and rehearsal', link: '/deployment/practice.html' },
          { text: 'Manual reference', link: '/deployment/manual.html' },
          { text: 'Deploy a viewer', link: '/viewer/deploy.html' },
        ] },
        { text: 'Per-application settings', items: [
          { text: 'Pay-to-Play', link: '/deployment/pay-to-play/' },
          { text: 'Escrow', link: '/deployment/escrow/' },
          { text: 'Bike NFT', link: '/deployment/bike-nft/' },
        ] },
        { text: 'Networks', items: [
          { text: 'EVM networks', link: '/deployment/networks/' },
          { text: 'RPC services', link: '/deployment/rpc/' },
        ] },
      ],
      '/reference/': [
        { text: 'Reference', items: [
          { text: 'Index', link: '/reference/' },
          { text: 'CAM specification versions', link: '/reference/cam/' },
          { text: 'Operations', link: '/reference/operations.html' },
          { text: 'Diagnostics', link: '/reference/diagnostics.html' },
        ] },
      ],
      '/pay-to-play/': [
        { text: 'Pay-to-Play', items: [
          { text: 'Overview', link: '/pay-to-play/' },
          { text: 'Integrate', link: '/pay-to-play/integration.html' },
          { text: 'Local payment', link: '/pay-to-play/local-payment.html' },
          { text: 'Deployment', link: '/deployment/pay-to-play/' },
        ] },
      ],
      '/escrow/': [
        { text: 'Escrow', items: [
          { text: 'Overview', link: '/escrow/' },
          { text: 'Documents', link: '/escrow/documents.html' },
          { text: 'Reference', link: '/escrow/reference.html' },
          { text: 'Deployment', link: '/deployment/escrow/' },
        ] },
      ],
      '/bike-nft/': [
        { text: 'Bike NFT', items: [
          { text: 'Overview', link: '/bike-nft/' },
          { text: 'Metadata', link: '/bike-nft/metadata.html' },
          { text: 'Ownership', link: '/bike-nft/ownership.html' },
          { text: 'Deployment', link: '/deployment/bike-nft/' },
        ] },
      ],
    },
    search: { provider: 'local' },
    outline: { level: [2, 3] },
    editLink: {
      pattern: 'https://github.com/numpde/dapp32/edit/main/docs/:path',
      text: 'Edit this page on GitHub',
    },
  },
})
