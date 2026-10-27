const catalogURL = 'https://raw.githubusercontent.com/numpde/dapp32/main/js/packages/cam-viewer/src/rpc-catalog.json';
const list = document.querySelector('#deployments');
const status = document.querySelector('#load-status');
const retry = document.querySelector('#retry');

function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function link(url, text, className) {
  const target = new URL(url, location.href);
  if ((target.protocol !== 'https:' && !(target.protocol === 'http:' && target.origin === location.origin)) || target.username || target.password) throw new Error('External links must use HTTPS without credentials.');
  const node = element('a', text, className);
  node.href = target.href;
  return node;
}

function addressValue(address, name, explorer) {
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) throw new Error(`Invalid address for ${name}.`);
  const value = element('span', undefined, 'address-value');
  const controls = element('span', undefined, 'address-controls');
  const addressLink = link(`${explorer.replace(/\/$/, '')}/address/${address}`);
  const code = element('code');
  code.title = address;
  const middle = element('span', address.slice(6, -4), 'hex-middle');
  const ellipsis = element('span', undefined, 'hex-ellipsis');
  ellipsis.setAttribute('aria-hidden', 'true');
  middle.append(ellipsis);
  code.append(element('span', address.slice(0, 6)), middle, element('span', address.slice(-4)));
  addressLink.append(code);
  addressLink.setAttribute('aria-label', `${name}: ${address}, view on explorer`);
  const copy = element('button', undefined, 'copy-address');
  copy.type = 'button';
  copy.setAttribute('aria-label', `Copy ${name} address`);
  copy.title = `Copy ${name} address`;
  const icon = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="11" height="12" rx="1.5"/><path d="M16 8V5.5A1.5 1.5 0 0 0 14.5 4h-9A1.5 1.5 0 0 0 4 5.5v11A1.5 1.5 0 0 0 5.5 18H8"/></svg>';
  copy.innerHTML = icon;
  const result = element('span', '', 'sr-only');
  result.setAttribute('role', 'status');
  let recovery;
  copy.addEventListener('click', async () => {
    copy.disabled = true;
    copy.setAttribute('aria-busy', 'true');
    copy.innerHTML = icon;
    result.textContent = '';
    recovery?.remove();
    recovery = undefined;
    try {
      if (!navigator.clipboard) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(address);
      copy.textContent = '✓';
      result.textContent = `${name} address copied`;
      recovery?.remove();
      recovery = undefined;
    } catch {
      if (!recovery) {
        recovery = element('span', 'Could not copy. Select the full address below.', 'copy-recovery');
        recovery.setAttribute('role', 'alert');
        const input = element('input');
        input.value = address;
        input.readOnly = true;
        input.setAttribute('aria-label', `Full ${name} address`);
        recovery.append(input);
        value.append(recovery);
      }
    } finally {
      copy.disabled = false;
      copy.setAttribute('aria-busy', 'false');
    }
  });
  controls.append(addressLink, copy, result);
  value.append(controls);
  return value;
}

function deploymentCard(deployment, viewer, catalog) {
  const network = catalog[deployment.network];
  if (!network) throw new Error(`Unknown network: ${deployment.network}.`);
  const card = element('article', undefined, 'card deployment');
  card.id = deployment.id;
  card.append(element('h2', deployment.name));
  const mainnet = catalog[network.mainnet];
  card.append(element('p', `${network.name}${mainnet ? ` (${mainnet.name} testnet)` : ''} · Chain ${network.chainId}`, 'network'));
  card.append(element('p', deployment.description));
  const viewerURL = new URL(viewer);
  viewerURL.searchParams.set('chainId', `eip155:${network.chainId}`);
  viewerURL.searchParams.set('host', deployment.host);
  const actions = element('div', undefined, 'actions');
  actions.append(link(viewerURL, 'Open app →', 'button primary'), link(deployment.guide, 'App guide', 'button'));
  card.append(actions);
  card.append(element('h3', 'Contracts'));
  const contracts = element('dl', undefined, 'contracts');
  for (const [name, address] of [['CAM root', deployment.host], ...Object.entries(deployment.bindings)]) {
    const row = element('div');
    const value = element('dd');
    value.append(addressValue(address, name, network.explorer));
    row.append(element('dt', name), value);
    contracts.append(row);
  }
  card.append(contracts, element('p', `Bindings checked ${deployment.checkedOn} at block ${deployment.blockNumber.toLocaleString('en-US')}. Open the app or explorer for current state.`, 'snapshot'));
  return card;
}

async function readJSON(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error(`HTTP ${response.status} loading ${new URL(url, location.href).pathname}`);
  return response.json();
}

async function load() {
  retry.hidden = true;
  status.hidden = false;
  status.setAttribute('role', 'status');
  status.textContent = 'Loading deployments…';
  list.replaceChildren();
  const jump = document.querySelector('#deployment-jump');
  jump.replaceChildren();
  jump.hidden = true;
  try {
    const [data, catalog] = await Promise.all([readJSON('./deployments.json'), readJSON(catalogURL)]);
    const cards = data.deployments.map(deployment => deploymentCard(deployment, data.viewer, catalog));
    for (const card of cards) jump.append(link(`#${card.id}`, card.querySelector('h2').textContent));
    jump.hidden = cards.length < 2;
    list.append(...cards);
    status.textContent = cards.length ? '' : 'No deployments are listed yet.';
    status.hidden = cards.length > 0;
  } catch (error) {
    status.setAttribute('role', 'alert');
    status.textContent = `Cannot load deployments: ${error.message}`;
    retry.hidden = false;
  }
}

retry.addEventListener('click', () => { void load(); });
void load();
