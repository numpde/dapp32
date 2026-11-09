// Progressive enhancement only: docs and primary links work without JavaScript.
(() => {
  const script = document.currentScript;
  if (!script) return;
  const root = new URL('./', script.src);
  if (!location.pathname.startsWith(root.pathname)) return;
  const relative = decodeURIComponent(location.pathname.slice(root.pathname.length));
  const path = relative === '' ? 'index.html' : relative.endsWith('/') ? `${relative}index.html` : relative;
  const main = document.querySelector('main#main');
  const article = main?.querySelector(':scope > article.narrow');
  if (!article || path === 'index.html') return;

  // A bounded index of related guides, never a duplicate of the global menu.
  const sections = {
    Start: [
      ['start/index.html', 'Overview'],
      ['start/local-wallet.html', 'Try Pay-to-Play locally'],
      ['start/fixture-wallet.html', 'Connect the test wallet'],
      ['examples/index.html', 'Local demos'],
    ],
    Use: [
      ['use/index.html', 'Use an app'],
      ['pay-to-play/index.html', 'Pay-to-Play'],
      ['escrow/index.html', 'Escrow'],
      ['bike-nft/index.html', 'Bike NFT'],
    ],
    'Pay-to-Play': [
      ['pay-to-play/index.html', 'Pay-to-Play'],
      ['pay-to-play/local-payment.html', 'Collect a test voucher'],
      ['pay-to-play/integration.html', 'Integrate payments'],
    ],
    Escrow: [
      ['escrow/index.html', 'Escrow'],
      ['escrow/documents.html', 'Document commitments'],
      ['escrow/reference.html', 'Contract behavior'],
    ],
    'Bike NFT': [
      ['bike-nft/index.html', 'Bike NFT'],
      ['bike-nft/ownership.html', 'Transfer and workshop access'],
      ['bike-nft/metadata.html', 'Metadata'],
    ],
    Build: [
      ['authoring/index.html', 'Build a workflow'],
      ['authoring/headless.html', 'Headless integrations'],
      ['development/index.html', 'Source setup'],
      ['development/app-checks.html', 'App checks'],
      ['development/payment-fixture.html', 'Payment fixture'],
    ],
    Deploy: [
      ['deployment/index.html', 'Deploy'],
      ['deployment/new-instance.html', 'New app instance'],
      ['viewer/deploy.html', 'Host the viewer'],
      ['deployment/update.html', 'Update an instance'],
      ['deployment/recovery.html', 'Recover a release'],
      ['deployment/source-verification.html', 'Verify sources'],
      ['deployment/practice.html', 'Rehearse a release'],
      ['deployment/networks/index.html', 'Networks and RPC'],
    ],
    'App deployment settings': [
      ['deployment/bike-nft/index.html', 'Bike NFT'],
      ['deployment/escrow/index.html', 'Escrow'],
      ['deployment/pay-to-play/index.html', 'Pay-to-Play'],
    ],
    Reference: [
      ['reference/index.html', 'Reference'],
      ['reference/cam/index.html', 'CAM versions'],
      ['reference/operations.html', 'Operational records'],
      ['reference/diagnostics.html', 'Diagnostics'],
      ['deployment/rpc/index.html', 'RPC services'],
    ],
  };
  const top = [
    ['Start', 'start/index.html'], ['Use', 'use/index.html'],
    ['Build', 'authoring/index.html'], ['Deploy', 'deployment/index.html'],
    ['Reference', 'reference/index.html'],
  ];
  const category = path.startsWith('start/') || path.startsWith('examples/') ? 'Start'
    : path.startsWith('pay-to-play/') ? 'Pay-to-Play'
    : path.startsWith('escrow/') ? 'Escrow'
    : path.startsWith('bike-nft/') ? 'Bike NFT'
    : path.startsWith('use/') ? 'Use'
    : path.startsWith('authoring/') || path.startsWith('development/') ? 'Build'
    : /^deployment\/(bike-nft|escrow|pay-to-play)\//.test(path) ? 'App deployment settings'
    : path === 'deployment/rpc/index.html' ? 'Reference'
    : path.startsWith('deployment/') || path.startsWith('viewer/') ? 'Deploy'
    : path.startsWith('reference/') ? 'Reference' : undefined;
  if (!category) return;
  const ancestor = ['Pay-to-Play', 'Escrow', 'Bike NFT'].includes(category) ? 'Use'
    : category === 'App deployment settings' ? 'Deploy' : category;
  const title = article.querySelector('h1')?.textContent?.trim() || category;
  const urlFor = path => new URL(path.endsWith('/index.html') ? path.slice(0, -10) : path, root).href;
  const anchor = (href, text, active = false) => {
    const a = document.createElement('a');
    a.href = href;
    a.textContent = text;
    if (active) a.setAttribute('aria-current', 'page');
    return a;
  };

  // Breadcrumb is separate from main so the skip link bypasses navigation.
  const bread = document.createElement('nav');
  bread.className = 'docs-breadcrumb shell';
  bread.setAttribute('aria-label', 'Breadcrumb');
  const trail = [anchor(root.href, 'Home')];
  if (ancestor !== category) {
    const parent = top.find(([label]) => label === ancestor);
    trail.push(anchor(urlFor(parent[1]), ancestor));
  }
  const first = sections[category][0];
  if (path !== first[0]) trail.push(anchor(urlFor(first[0]), category));
  const current = document.createElement('span');
  current.textContent = path === first[0] && category === ancestor ? category : title;
  current.setAttribute('aria-current', 'page');
  trail.push(current);
  trail.forEach((item, i) => {
    if (i) {
      const divider = document.createElement('span');
      divider.textContent = '/';
      divider.setAttribute('aria-hidden', 'true');
      bread.append(divider);
    }
    bread.append(item);
  });

  const layout = document.createElement('div');
  layout.className = 'docs-layout shell';
  const side = document.createElement('aside');
  side.className = 'docs-rail';
  side.setAttribute('aria-label', 'Documentation navigation');
  const media = matchMedia('(max-width: 860px)');
  function group(label, entries) {
    const details = document.createElement('details');
    details.open = !media.matches;
    const summary = document.createElement('summary');
    summary.textContent = label;
    const nav = document.createElement('nav');
    nav.setAttribute('aria-label', label);
    for (const [href, text, active] of entries) nav.append(anchor(href, text, active));
    details.append(summary, nav);
    side.append(details);
  }
  group(`In ${category}`, sections[category].map(([dest, name]) => [urlFor(dest), name, dest === path]));

  // Show section jumps only on longer pages; preserve existing explicit IDs.
  const headings = [...article.querySelectorAll('h2')];
  const seen = new Set([...document.querySelectorAll('[id]')].map(node => node.id));
  const slug = text => text.normalize('NFKD').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 64);
  const toc = [];
  for (const heading of headings) {
    if (!heading.id) {
      const stem = slug(heading.textContent) || 'section';
      let id = stem;
      for (let n = 2; seen.has(id); n++) id = `${stem}-${n}`;
      heading.id = id;
      seen.add(id);
    }
    toc.push([`#${encodeURIComponent(heading.id)}`, heading.textContent.trim()]);
  }
  if (toc.length >= 4) group('On this page', toc.slice(0, 9));
  const section = top.find(([name]) => name === ancestor);
  const selected = [...document.querySelectorAll('.topbar nav a')]
    .find(link => link.href === urlFor(section[1]));
  if (selected && !selected.hasAttribute('aria-current')) selected.setAttribute('aria-current', 'location');

  main.parentNode.insertBefore(bread, main);
  main.parentNode.insertBefore(layout, main);
  layout.append(side, main);
  main.classList.add('docs-main');
  main.classList.remove('shell');
  media.addEventListener('change', () => {
    for (const details of side.querySelectorAll('details')) details.open = !media.matches;
  });
})();
