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
  const middle = element('span', address.slice(8, -6), 'hex-middle');
  const ellipsis = element('span', undefined, 'hex-ellipsis');
  ellipsis.setAttribute('aria-hidden', 'true');
  middle.append(ellipsis);
  code.append(element('span', address.slice(0, 8)), middle, element('span', address.slice(-6)));
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

function deploymentCard(deployment, viewer, catalog, embedded = false) {
  const network = catalog[deployment.network];
  if (!network) throw new Error(`Unknown network: ${deployment.network}.`);
  const card = element(embedded ? 'div' : 'article', undefined, embedded ? 'deployment-instance' : 'card deployment');
  card.id = deployment.id;
  if (!embedded) {
    const heading = element('div', undefined, 'deployment-heading');
    heading.append(element('h2', deployment.name));
    card.append(heading);
  }
  const mainnet = catalog[network.mainnet];
  const overview = element('div', undefined, 'deployment-overview');
  overview.append(element('p', `${network.name}${mainnet ? ` (${mainnet.name} testnet)` : ''} · Chain ${network.chainId}`, 'network'));
  const viewerURL = new URL(viewer);
  viewerURL.searchParams.set('chainId', `eip155:${network.chainId}`);
  viewerURL.searchParams.set('host', deployment.host);
  const actions = element('div', undefined, 'actions');
  actions.append(link(viewerURL, 'Open app'), link(deployment.guide, 'App guide'));
  overview.append(actions);
  card.append(overview);
  card.append(element('h3', 'Contracts'));
  const contracts = element('dl', undefined, 'contracts');
  function contractRow(name, address, source, verification) {
    const row = element('div');
    const label = element('dt');
    label.append(source === undefined ? name : link(source, name));
    const value = element('dd', undefined, 'contract-address');
    value.append(address === null ? element('span', 'Not bound') : addressValue(address, name, network.explorer));
    row.append(label, value);
    if (verification) {
      const proof = element('dd', undefined, 'contract-verification');
      const verified = link(verification, 'Verified', 'verification-link');
      verified.title = 'View the recorded exact creation and runtime bytecode match on Sourcify';
      verified.setAttribute('aria-label', `${name}: view exact-match source verification on Sourcify`);
      proof.append(verified);
      row.append(proof);
    }
    return row;
  }
  contracts.append(contractRow('CAM root', deployment.host, deployment.hostSource, deployment.hostVerificationUrl));
  const rpcSettings = element('details', undefined, 'rpc-settings');
  rpcSettings.append(element('summary', 'RPC connection'));
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
  const bindingStatus = element('p', '', 'binding-status');
  bindingStatus.setAttribute('role', 'status');
  const retryBindings = element('button', 'Retry contract lookup', 'button');
  retryBindings.type = 'button';
  retryBindings.hidden = true;
  rpcControls.append(rpcSelect, customRPC, working);
  rpcSettings.append(rpcControls);
  rpcSettings.open = !rpcSelect.value;
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
    contracts.replaceChildren(contractRow('CAM root', deployment.host, deployment.hostSource, deployment.hostVerificationUrl));
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
      const rows = await Promise.all(deployment.contracts.map(async contract => {
        const { name, source } = contract;
        const result = await rpc(endpoint, 'eth_call', [{ to: deployment.host, data: bindingCall(name) }, block], signal);
        if (!/^0x0{24}[0-9a-fA-F]{40}$/.test(result)) throw new Error(`Invalid contract address returned for ${name}.`);
        const address = `0x${result.slice(-40)}`;
        const bound = /^0x0{40}$/.test(address) ? null : address;
        const sourceMatches = bound !== null && bound.toLowerCase() === source.address.toLowerCase();
        return contractRow(name, bound, sourceMatches ? source.url : undefined, sourceMatches ? source.verificationUrl : undefined);
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
      rpcSettings.open = true;
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
  card.append(contracts, bindingStatus, retryBindings, rpcSettings);
  if (rpcSelect.value) void loadBindings();
  card.cancelBindings = () => { clearTimeout(debounce); pendingRPC?.abort(); };
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

function groupDeployments(deployments) {
  const groups = new Map();
  for (const deployment of deployments) {
    const key = deployment.appId || deployment.id;
    if (!groups.has(key)) groups.set(key, []);
    const group = groups.get(key);
    if (group.length && group[0].name !== deployment.name) throw new Error(`Inconsistent application name: ${key}.`);
    group.push(deployment);
  }
  return [...groups.values()];
}

let selectableGroups = [];
function selectionFromHash() {
  const id = decodeURIComponent(location.hash.slice(1));
  for (const group of selectableGroups) {
    if (!id) group.show(group.latest);
    if (group.ids.has(id)) {
      group.show(id);
      document.getElementById(id)?.closest('.deployment')?.scrollIntoView();
      return;
    }
  }
}
window.addEventListener('hashchange', selectionFromHash);

async function load() {
  retry.hidden = true;
  status.hidden = false;
  status.setAttribute('role', 'status');
  status.textContent = 'Loading deployments…';
  selectableGroups.forEach(group => group.cancel());
  selectableGroups = [];
  list.replaceChildren();
  const jump = document.querySelector('#deployment-jump');
  jump.replaceChildren();
  jump.hidden = true;
  try {
    const [data, catalog] = await Promise.all([readJSON('./deployments.json'), readJSON(catalogURL)]);
    const groups = groupDeployments(data.deployments);
    const requested = decodeURIComponent(location.hash.slice(1));
    const rendered = [];
    for (const deployments of groups) {
      if (deployments.length === 1) {
        const card = deploymentCard(deployments[0], data.viewer, catalog);
        rendered.push(card);
        jump.append(link(`#${card.id}`, deployments[0].name));
        continue;
      }
      if (deployments.some(deployment => !/^\d{4}-\d{2}-\d{2}$/.test(deployment.deployedAt))) {
        throw new Error(`Deployment dates are missing for ${deployments[0].name}.`);
      }
      const ordered = [...deployments].sort((a, b) => b.deployedAt.localeCompare(a.deployedAt));
      const group = element('article', undefined, 'card deployment');
      const heading = element('div', undefined, 'deployment-heading');
      heading.append(element('h2', deployments[0].name));
      const select = element('select');
      select.id = `deployment-select-${deployments[0].appId}`;
      select.setAttribute('aria-label', `${deployments[0].name} deployment`);
      for (const [index, deployment] of ordered.entries()) {
        const option = element('option', `${deployment.deployedAt}${index === 0 ? ' · Latest' : ''}`);
        option.value = deployment.id;
        select.append(option);
      }
      heading.append(select);
      group.append(heading);
      const details = element('div');
      group.append(details);
      const jumpLink = link(`#${ordered[0].id}`, deployments[0].name);
      let active;
      function show(id) {
        if (active?.id === id) return;
        const deployment = ordered.find(item => item.id === id);
        if (!deployment) return;
        active?.cancelBindings();
        active = deploymentCard(deployment, data.viewer, catalog, true);
        details.replaceChildren(active);
        select.value = id;
        jumpLink.href = `#${id}`;
      }
      select.addEventListener('change', () => {
        show(select.value);
        // Changing this control should not scroll its own heading out of view.
        const fragment = `#${select.value}`;
        if (location.hash !== fragment) history.pushState(null, '', fragment);
      });
      show(ordered.some(item => item.id === requested) ? requested : ordered[0].id);
      selectableGroups.push({ ids: new Set(ordered.map(item => item.id)), latest: ordered[0].id, show, cancel: () => active?.cancelBindings() });
      jump.append(jumpLink);
      rendered.push(group);
    }
    list.append(...rendered);
    jump.hidden = rendered.length < 2;
    status.textContent = rendered.length ? '' : 'No deployments are listed yet.';
    status.hidden = rendered.length > 0;
    if (requested && data.deployments.some(deployment => deployment.id === requested)) {
      document.getElementById(requested)?.closest('.deployment')?.scrollIntoView();
    }
  } catch (error) {
    status.setAttribute('role', 'alert');
    status.textContent = `Cannot load deployments: ${error.message}`;
    retry.hidden = false;
  }
}

retry.addEventListener('click', () => { void load(); });
void load();
