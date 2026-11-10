// Render catalog-owned network facts without repeating a wide service table.
export async function mountNetworks() {
  const catalogURL = 'https://raw.githubusercontent.com/numpde/dapp32/main/js/packages/cam-viewer/src/rpc-catalog.json';
  const status = document.querySelector('#load-status');
  const details = document.querySelector('#networks');
  const jump = document.querySelector('#network-jump');
  const radios = [...document.querySelectorAll('input[name=view]')];
  const controller = new AbortController();

  function element(tag, text, className) {
    const result = document.createElement(tag);
    if (text !== undefined) result.textContent = String(text);
    if (className) result.className = className;
    return result;
  }

  function link(url, text) {
    if (new URL(url).protocol !== 'https:') {
      throw new Error('References and explorer links must use HTTPS.');
    }
    const result = element('a', text);
    result.href = url;
    return result;
  }

  function fact(label, value) {
    const item = element('div');
    item.append(element('dt', label), element('dd', value));
    return item;
  }

  try {
    const response = await fetch(catalogURL, { cache: 'no-store', signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const catalog = await response.json();
    const mainnets = Object.entries(catalog)
      .filter(([, chain]) => !chain.mainnet)
      .sort((a, b) => a[1].index - b[1].index);
    if (!mainnets.length) throw new Error('No mainnets in the catalog');

    const testnets = new Map(mainnets.map(([key]) => {
      const pair = Object.entries(catalog).filter(([, chain]) => chain.mainnet === key);
      if (pair.length !== 1) throw new Error(`Expected one application testnet for ${key}`);
      return [key, pair[0]];
    }));
    if (controller.signal.aborted) return () => controller.abort();

    jump.replaceChildren(...mainnets.map(([key, chain]) => {
      const option = element('option', `${String(chain.index).padStart(2, '0')} · ${chain.name}`);
      option.value = key;
      return option;
    }));

    const requestedView = new URL(location.href).searchParams.get('view');
    radios.find(radio => radio.value === (requestedView === 'mainnet' ? 'mainnet' : 'testnet')).checked = true;
    const requestedNetwork = location.hash.slice(1);
    jump.value = mainnets.some(([key]) => key === requestedNetwork) ? requestedNetwork : mainnets[0][0];

    function render() {
      const mainnetKey = jump.value;
      const mainnet = catalog[mainnetKey];
      const view = radios.find(radio => radio.checked).value;
      const chain = view === 'mainnet' ? mainnet : testnets.get(mainnetKey)[1];
      const label = view === 'mainnet' ? mainnet.name : `${chain.name} [${mainnet.name}]`;
      const article = element('article', undefined, 'network-card');
      article.id = mainnetKey;

      const heading = element('div', undefined, 'network-heading');
      heading.append(element('h3', label));
      const anchor = element('a', 'Link to this network');
      anchor.href = `#${mainnetKey}`;
      heading.append(anchor);
      article.append(heading);

      const facts = element('dl', undefined, 'network-facts');
      facts.append(
        fact('Index', String(mainnet.index).padStart(2, '0')),
        fact('Chain ID', chain.chainId),
        fact('Gas token', chain.symbol),
      );
      article.append(facts);

      const services = element('section', undefined, 'network-services');
      services.append(element('h4', 'RPC services'));
      if (chain.retired) {
        services.append(element('p', 'Retired network — no selectable RPC endpoint.'));
      } else {
        for (const [provider, url] of Object.entries(chain.services)) {
          const item = element('div', undefined, 'network-service');
          item.append(element('strong', provider === 'public' ? 'Public · no API key' : provider));
          item.append(element('code', url));
          services.append(item);
        }
      }
      article.append(services);

      const references = element('section', undefined, 'network-references');
      references.append(element('h4', 'Explorer and references'));
      const explorer = element('p');
      explorer.append('Explorer: ', link(chain.explorer, new URL(chain.explorer).hostname));
      references.append(explorer);
      const sources = element('ul');
      for (const url of chain.references) {
        const source = element('li');
        source.append(link(url, new URL(url).hostname));
        sources.append(source);
      }
      references.append(sources, element('p', `Sources checked ${chain.checkedOn}`, 'network-source-date'));
      article.append(references);

      details.replaceChildren(article);
      status.textContent = `${label} · chain ${chain.chainId}. Select another network or change the view.`;

      const current = new URL(location.href);
      current.searchParams.set('view', view);
      history.replaceState(null, '', current);
    }

    function selectNetwork() {
      const current = new URL(location.href);
      current.hash = jump.value;
      history.replaceState(null, '', current);
      render();
    }

    function followHash() {
      const selected = location.hash.slice(1);
      if (mainnets.some(([key]) => key === selected)) {
        jump.value = selected;
        render();
        document.getElementById(selected)?.scrollIntoView();
      }
    }

    jump.addEventListener('change', selectNetwork, { signal: controller.signal });
    radios.forEach(radio => radio.addEventListener('change', render, { signal: controller.signal }));
    window.addEventListener('hashchange', followHash, { signal: controller.signal });
    render();
    document.querySelector('#reference').hidden = false;
    if (mainnets.some(([key]) => key === requestedNetwork)) {
      document.getElementById(requestedNetwork)?.scrollIntoView();
    }
  } catch (error) {
    if (!controller.signal.aborted) {
      status.textContent = `Cannot load the network catalog: ${error.message}. Reload this page to retry.`;
    }
  }

  return () => controller.abort();
}
