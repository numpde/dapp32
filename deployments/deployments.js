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

function explorerAddress(explorer, address) {
  return `${explorer.replace(/\/$/, '')}/address/${address}`;
}

function addressValue(address, name, explorer) {
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) throw new Error(`Invalid address for ${name}.`);
  const value = element('span', undefined, 'address-value');
  const controls = element('span', undefined, 'address-controls');
  const addressLink = link(explorerAddress(explorer, address));
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
  const viewerURL = new URL(viewer);
  viewerURL.searchParams.set('chainId', `eip155:${network.chainId}`);
  viewerURL.searchParams.set('host', deployment.host);
  const actions = element('div', undefined, 'actions');
  actions.append(link(viewerURL, 'Open app →', 'button primary'), link(deployment.guide, 'App guide', 'button'));
  card.append(actions);
  card.append(element('h3', 'Contracts'));
  const contracts = element('dl', undefined, 'contracts');
  function contractRow(name, address) {
    const row = element('div');
    const value = element('dd');
    value.append(address === null ? element('span', 'Not bound') : addressValue(address, name, network.explorer));
    const label = element('dt');
    label.append(address === null ? name : link(explorerAddress(network.explorer, address), name));
    row.append(label, value);
    return row;
  }
  contracts.append(contractRow('CAM root', deployment.host));
  const rpcControls = element('div', undefined, 'rpc-controls');
  const rpcSelect = element('select');
  rpcSelect.setAttribute('aria-label', 'RPC endpoint');
  const endpoints = Object.values(network.services).filter(url => !/[{}]/u.test(url));
  if (deployment.rpcUrl && !endpoints.includes(deployment.rpcUrl)) endpoints.unshift(deployment.rpcUrl);
  for (const url of endpoints) {
    const option = element('option', new URL(url).hostname);
    option.value = url;
    rpcSelect.append(option);
  }
  const customOption = element('option', 'Custom RPC');
  customOption.value = '';
  rpcSelect.append(customOption);
  rpcSelect.value = deployment.rpcUrl ?? endpoints[0] ?? '';
  const customRPC = element('input');
  customRPC.type = 'url';
  customRPC.placeholder = 'https://rpc.example/';
  customRPC.setAttribute('aria-label', 'Custom RPC URL');
  customRPC.autocomplete = 'off';
  customRPC.spellcheck = false;
  customRPC.hidden = rpcSelect.value !== '';
  const working = element('span');
  working.setAttribute('role', 'status');
  const bindingStatus = element('p', '', 'network');
  bindingStatus.setAttribute('role', 'status');
  const retryBindings = element('button', 'Retry contract lookup', 'button');
  retryBindings.type = 'button';
  retryBindings.hidden = true;
  rpcControls.append(rpcSelect, customRPC, working);
  let pendingRPC;
  let debounce;
  function resetBindings() {
    clearTimeout(debounce);
    pendingRPC?.abort();
    working.textContent = '';
    working.removeAttribute('aria-label');
    bindingStatus.hidden = true;
    retryBindings.hidden = true;
    customRPC.removeAttribute('aria-invalid');
    contracts.replaceChildren(contractRow('CAM root', deployment.host));
  }
  async function loadBindings() {
    resetBindings();
    const attempt = new AbortController();
    pendingRPC = attempt;
    const signal = AbortSignal.any([attempt.signal, AbortSignal.timeout(10000)]);
    bindingStatus.hidden = false;
    bindingStatus.setAttribute('role', 'status');
    bindingStatus.textContent = 'Loading contracts…';
    try {
      if (!rpcSelect.value && !customRPC.validity.valid) throw new Error('Enter a valid RPC URL.');
      const endpoint = new URL(rpcSelect.value || customRPC.value.trim());
      if (!['https:', 'http:'].includes(endpoint.protocol) || endpoint.username || endpoint.password) throw new Error('Enter an HTTP or HTTPS RPC URL without credentials.');
      const chain = await rpc(endpoint, 'eth_chainId', [], signal);
      if (BigInt(chain) !== BigInt(network.chainId)) throw new Error('RPC returned a different chain.');
      const block = await rpc(endpoint, 'eth_blockNumber', [], signal);
      const rows = await Promise.all(deployment.contracts.map(async name => {
        const result = await rpc(endpoint, 'eth_call', [{ to: deployment.host, data: bindingCall(name) }, block], signal);
        if (!/^0x0{24}[0-9a-fA-F]{40}$/.test(result)) throw new Error(`Invalid contract address returned for ${name}.`);
        const address = `0x${result.slice(-40)}`;
        return contractRow(name, /^0x0{40}$/.test(address) ? null : address);
      }));
      if (attempt.signal.aborted) return;
      contracts.append(...rows);
      bindingStatus.hidden = true;
      working.textContent = '✓';
      working.setAttribute('aria-label', 'RPC working');
    } catch (error) {
      if (attempt.signal.aborted) return;
      bindingStatus.setAttribute('role', 'alert');
      bindingStatus.textContent = `Cannot load contract addresses: ${error.message}`;
      if (!rpcSelect.value) customRPC.setAttribute('aria-invalid', 'true');
      retryBindings.hidden = false;
    }
  }
  rpcSelect.addEventListener('change', () => {
    customRPC.hidden = rpcSelect.value !== '';
    resetBindings();
    if (rpcSelect.value || customRPC.value.trim()) void loadBindings();
  });
  customRPC.addEventListener('input', () => {
    resetBindings();
    if (customRPC.value.trim()) debounce = setTimeout(() => { void loadBindings(); }, 400);
  });
  customRPC.addEventListener('keydown', event => {
    if (event.key === 'Enter') { event.preventDefault(); void loadBindings(); }
  });
  retryBindings.addEventListener('click', () => { void loadBindings(); });
  card.append(rpcControls, contracts, bindingStatus, retryBindings);
  if (rpcSelect.value) void loadBindings();
  return card;
}

// CAM's contractAddress(string), encoded as one dynamic UTF-8 string argument.
function bindingCall(name) {
  const bytes = new TextEncoder().encode(name);
  const word = value => value.toString(16).padStart(64, '0');
  const text = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  return `0x1eb726af${word(32)}${word(bytes.length)}${text.padEnd(Math.ceil(bytes.length / 32) * 64, '0')}`;
}

async function rpc(endpoint, method, params, signal) {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    signal,
  });
  if (!response.ok) throw new Error(`RPC HTTP ${response.status}.`);
  const reply = await response.json();
  if (reply.error) throw new Error(reply.error.message);
  return reply.result;
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
