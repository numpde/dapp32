// Ported from gh-pages/deployment/networks/index.html.
export async function mountNetworks() {

  const status = document.querySelector('#load-status');
  const tbody = document.querySelector('#networks');
  const jump = document.querySelector('#network-jump');
  const radios = [...document.querySelectorAll('input[name=view]')];
  const requestedView = new URL(location.href).searchParams.get('view');
  if (requestedView === 'mainnet') radios[0].checked = true;
  let catalog;
  let mainnets;

  function element(tag, text) {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function link(url, text) {
    if (!url.startsWith('#') && new URL(url).protocol !== 'https:') {
      throw new Error('Reference and explorer links must use HTTPS.');
    }
    const node = element('a', text);
    node.href = url;
    return node;
  }

  function render() {
    const view = radios.find(radio => radio.checked).value;
    document.querySelector('#table-caption').textContent = view === 'mainnet' ? 'Mainnets' : 'Application testnets';
    for (const [mainnetKey, mainnet] of mainnets) {
      const row = document.getElementById(mainnetKey);
      while (row.children.length > 1) row.lastElementChild.remove();
      const chains = view === 'mainnet' ? [[mainnetKey, mainnet]] : Object.entries(catalog).filter(([, chain]) => chain.mainnet === mainnetKey);
      const [chainKey, chain] = chains[0];
      const name = element('th', view === 'mainnet' ? chain.name : `${chain.name} [${mainnet.name}]`);
      name.scope = 'row';
      name.append(element('small', chainKey));
      if (chain.retired) name.prepend(element('span', 'Retired'), element('br'));
      name.querySelector('span')?.classList.add('retired');
      if (chain.note) name.append(element('small', chain.note));
      const services = element('td');
      for (const [provider, endpoint] of Object.entries(chain.services)) {
        const service = element('div');
        service.className = 'service';
        service.append(element('strong', provider === 'public' ? 'Public · no API key' : provider), element('code', endpoint));
        services.append(service);
      }
      if (chain.retired) services.textContent = 'Retired — no RPC endpoint';
      const sources = element('td');
      for (const url of chain.references) {
        const source = link(url, new URL(url).hostname);
        source.className = 'reference';
        source.title = url;
        sources.append(source);
      }
      sources.append(element('small', `Sources checked ${chain.checkedOn}`));
      const explorer = element('td');
      if (chain.retired) explorer.textContent = 'Historical network';
      else explorer.append(link(chain.explorer, new URL(chain.explorer).hostname));
      row.append(name, element('td', String(chain.chainId)), element('td', chain.symbol), services, explorer, sources);
    }
    const url = new URL(location.href);
    url.searchParams.set('view', view);
    history.replaceState(null, '', url);
    status.textContent = `${mainnets.length} networks · ${view === 'mainnet' ? 'Mainnets' : 'Testnets'} shown`;
  }

  function showCatalog(selectedCatalog) {
    if (!selectedCatalog || Array.isArray(selectedCatalog) || typeof selectedCatalog !== 'object' || !Object.keys(selectedCatalog).length) {
      throw new Error('The catalog must contain network entries.');
    }
    catalog = selectedCatalog;
    mainnets = Object.entries(catalog).filter(([, chain]) => !chain.mainnet).sort((a, b) => a[1].index - b[1].index);
    if (!mainnets.length || mainnets.some(([key]) => Object.values(catalog).filter(chain => chain.mainnet === key).length !== 1)) {
      throw new Error('Each mainnet must have one application-testnet entry.');
    }
    tbody.replaceChildren();
    jump.replaceChildren(element('option', 'Choose a network'));
    jump.firstElementChild.value = '';
    for (const [key, mainnet] of mainnets) {
      const row = element('tr');
      row.id = key;
      const index = element('td');
      index.append(link(`#${key}`, String(mainnet.index).padStart(2, '0')));
      row.append(index);
      tbody.append(row);
      const option = element('option', `${String(mainnet.index).padStart(2, '0')} · ${mainnet.name}`);
      option.value = key;
      jump.append(option);
    }
    render();
    document.querySelector('#reference').hidden = false;
    if (location.hash) document.getElementById(location.hash.slice(1))?.scrollIntoView();
  }

  radios.forEach(radio => radio.addEventListener('change', render));
  jump.addEventListener('change', () => {
    if (jump.value) location.hash = jump.value;
  });
  try {
    const response = await fetch('https://raw.githubusercontent.com/numpde/dapp32/main/js/packages/cam-viewer/src/rpc-catalog.json', {cache: 'no-store'});
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    showCatalog(await response.json());
  } catch (error) {
    document.querySelector('#reference').hidden = true;
    status.textContent = `Cannot load the RPC catalog: ${error.message}. Reload this page to retry.`;
  }

return () => {
  radios.forEach(radio => radio.removeEventListener('change', render));
};
}
