// One documented hierarchy for all maintained guides. The original pages,
// links and primary navigation still work if this enhancement is unavailable.
(() => {
  const script = document.currentScript;
  if (!script) return;
  const root = new URL('./', script.src);
  if (!location.pathname.startsWith(root.pathname)) return;
  let path;
  try {
    const relative = decodeURIComponent(location.pathname.slice(root.pathname.length));
    path = relative === '' ? 'index.html' : relative.endsWith('/') ? relative + 'index.html' : relative;
  } catch { return; }
  // Gallery and the homepage are destinations in their own right, not guides.
  if (path === 'index.html' || path === 'gallery/index.html') return;

  // Every guide appears exactly once below. Groups are collapsed until relevant,
  // so the sidebar is an orientation aid, not another wall of links.
  const sections = [
    { name: 'Start', root: 'start/index.html', pages: [
      ['start/index.html', 'What runs where'],
      ['start/local-wallet.html', 'Try Pay-to-Play locally'],
      ['start/fixture-wallet.html', 'Connect the test wallet'],
      ['examples/index.html', 'Local demos'],
    ] },
    { name: 'Use', root: 'use/index.html', pages: [
      ['use/index.html', 'Use an app'],
      { name: 'Pay-to-Play', root: 'pay-to-play/index.html', pages: [
        ['pay-to-play/index.html', 'Overview'],
        ['pay-to-play/local-payment.html', 'Try a voucher payment'],
        ['pay-to-play/integration.html', 'Integrate payments'],
      ] },
      { name: 'Escrow', root: 'escrow/index.html', pages: [
        ['escrow/index.html', 'Overview'],
        ['escrow/documents.html', 'Prepare documents'],
        ['escrow/reference.html', 'Contract behavior'],
      ] },
      { name: 'Bike NFT', root: 'bike-nft/index.html', pages: [
        ['bike-nft/index.html', 'Overview'],
        ['bike-nft/ownership.html', 'Ownership and workshops'],
        ['bike-nft/metadata.html', 'Metadata'],
      ] },
    ] },
    { name: 'Build', root: 'authoring/index.html', pages: [
      ['authoring/index.html', 'Build a workflow'],
      ['authoring/headless.html', 'Headless integration'],
      ['development/index.html', 'Source setup'],
      ['development/app-checks.html', 'App checks'],
      ['development/payment-fixture.html', 'Payment fixture'],
    ] },
    { name: 'Deploy', root: 'deployment/index.html', pages: [
      ['deployment/index.html', 'Choose a deployment task'],
      ['deployment/new-instance.html', 'Deploy a new instance'],
      ['viewer/deploy.html', 'Host the stand-alone viewer'],
      ['deployment/update.html', 'Update an instance'],
      ['deployment/recovery.html', 'Recover a release'],
      ['deployment/source-verification.html', 'Verify contract sources'],
      ['deployment/practice.html', 'Rehearse a release'],
      { name: 'App settings', root: 'deployment/index.html#app-settings', pages: [
        ['deployment/bike-nft/index.html', 'Bike NFT'],
        ['deployment/escrow/index.html', 'Escrow'],
        ['deployment/pay-to-play/index.html', 'Pay-to-Play'],
      ] },
      { name: 'Older bookmarks', root: 'deployment/index.html', pages: [
        ['deployment/manual.html', 'Legacy manual index'],
      ] },
    ] },
    { name: 'Reference', root: 'reference/index.html', pages: [
      ['reference/index.html', 'Reference overview'],
      ['reference/cam/index.html', 'CAM specifications'],
      ['reference/operations.html', 'Operational records'],
      ['reference/diagnostics.html', 'Diagnostics'],
      ['deployment/networks/index.html', 'Networks'],
      ['deployment/rpc/index.html', 'RPC services'],
    ] },
  ];
  const pages = sections.flatMap(section => section.pages.flatMap(item =>
    Array.isArray(item)
      ? [{ path: item[0], section }]
      : item.pages.map(page => ({ path: page[0], section, group: item }))
  ));
  const record = pages.find(entry => entry.path === path);
  if (!record) return;
  const { section, group } = record;
  const main = document.querySelector('main#main');
  if (!main) return;
  const article = main.querySelector(':scope > article.narrow');
  const title = (article || main).querySelector('h1')?.textContent?.trim() || section.name;
  const urlFor = item => new URL(item.endsWith('/index.html') ? item.slice(0, -10) : item, root).href;
  const anchor = (href, label, active = false) => {
    const link = document.createElement('a');
    link.href = href;
    link.textContent = label;
    if (active) link.setAttribute('aria-current', 'page');
    return link;
  };

  // The top-level current location is always the parent section.
  const top = [...document.querySelectorAll('.topbar nav a')]
    .find(link => link.href === urlFor(section.root));
  if (top && !top.hasAttribute('aria-current')) top.setAttribute('aria-current', 'location');

  const bread = document.createElement('nav');
  bread.className = 'docs-breadcrumb shell';
  bread.setAttribute('aria-label', 'Breadcrumb');
  const trail = [anchor(root.href, 'Home')];
  if (path !== section.root) trail.push(anchor(urlFor(section.root), section.name));
  if (group && path !== group.root) trail.push(anchor(urlFor(group.root), group.name));
  const here = document.createElement('span');
  here.textContent = path === section.root ? section.name
    : group && path === group.root ? group.name : title;
  here.setAttribute('aria-current', 'page');
  trail.push(here);
  const ordered = document.createElement('ol');
  for (const item of trail) {
    const li = document.createElement('li');
    li.append(item);
    ordered.append(li);
  }
  bread.append(ordered);

  const rail = document.createElement('aside');
  rail.className = 'docs-rail';
  rail.setAttribute('aria-label', 'Documentation navigation');
  const mobile = matchMedia('(max-width: 860px)');
  const outer = document.createElement('details');
  outer.className = 'docs-section';
  outer.open = !mobile.matches;
  const summary = document.createElement('summary');
  summary.textContent = 'In ' + section.name;
  outer.append(summary);
  const index = document.createElement('nav');
  index.className = 'docs-section-links';
  index.setAttribute('aria-label', 'In ' + section.name);
  for (const item of section.pages) {
    if (Array.isArray(item)) {
      index.append(anchor(urlFor(item[0]), item[1], item[0] === path));
    } else {
      const details = document.createElement('details');
      details.className = 'docs-subsection';
      details.open = item.pages.some(([file]) => file === path);
      const heading = document.createElement('summary');
      heading.textContent = item.name;
      details.append(heading);
      const children = document.createElement('div');
      children.className = 'docs-subsection-links';
      for (const [file, label] of item.pages) {
        children.append(anchor(urlFor(file), label, file === path));
      }
      details.append(children);
      index.append(details);
    }
  }
  outer.append(index);
  rail.append(outer);

  // Section entry points and guides with their own internal contents links
  // already serve as a page index; a second one would just duplicate links.
  if (article && path !== section.root && !path.endsWith('/manual.html')
      && !article.querySelector('nav a[href^="#"]')) {
    const headings = [...article.querySelectorAll('h2')];
    if (headings.length >= 4) {
      const existing = new Set([...document.querySelectorAll('[id]')].map(x => x.id));
      const added = new Set();
      const entries = [];
      for (const heading of headings) {
        if (!heading.id) {
          const stem = heading.textContent.normalize('NFKD').toLowerCase()
            .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 64) || 'section';
          let id = stem;
          for (let n = 2; existing.has(id); n++) id = stem + '-' + n;
          heading.id = id;
          existing.add(id);
          added.add(id);
        }
        entries.push(anchor('#' + encodeURIComponent(heading.id), heading.textContent.trim()));
      }
      const toc = document.createElement('details');
      toc.className = 'docs-toc';
      toc.open = !mobile.matches;
      const label = document.createElement('summary');
      label.textContent = 'On this page';
      const links = document.createElement('nav');
      links.setAttribute('aria-label', 'On this page');
      links.append(...entries);
      toc.append(label, links);
      rail.append(toc);
      if (location.hash) {
        try {
          const target = decodeURIComponent(location.hash.slice(1));
          if (added.has(target)) {
            requestAnimationFrame(() => document.getElementById(target)?.scrollIntoView());
          }
        } catch { /* Preserve the guide for malformed fragment URLs. */ }
      }
    }
  }

  const layout = document.createElement('div');
  layout.className = 'docs-layout shell';
  // The network catalog is wide by design; its table, not the page, scrolls.
  if (!article) { main.classList.add('docs-wide'); layout.classList.add('docs-layout-wide'); }
  main.parentNode.insertBefore(bread, main);
  main.parentNode.insertBefore(layout, main);
  layout.append(rail, main);
  main.classList.add('docs-main');
  main.classList.remove('shell');
  mobile.addEventListener('change', () => {
    outer.open = !mobile.matches;
    const toc = rail.querySelector('.docs-toc');
    if (toc) toc.open = !mobile.matches;
  });
})();
