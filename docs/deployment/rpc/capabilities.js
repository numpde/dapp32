/** Show the recorded RPC measurements one network at a time. */
import './capabilities.css';

export function mountCapabilities() {
  const status = document.querySelector('#capability-status');
  const summary = document.querySelector('#capability-summary');
  const source = document.querySelector('#capability-source');
  const results = document.querySelector('#capability-results');
  const networkChoice = document.querySelector('#capability-network');
  const networkTitle = document.querySelector('#capability-selected-network');
  const providers = document.querySelector('#capability-providers');
  const controller = new AbortController();
  const reportURL = import.meta.env.BASE_URL + 'deployment/rpc/capabilities.json';

  const labels = {
    ok: 'Succeeded',
    rejected_unknown_hash: 'Unknown hash rejected',
    rpc_error: 'RPC error',
    method_not_found: 'Method unavailable',
    authentication_required: 'Authentication required',
    rate_limited: 'Rate limited',
    http_error: 'HTTP error',
    timeout: 'Timed out',
    response_limit: 'Response exceeded probe limit',
    invalid_result: 'Invalid response',
    inconsistent: 'Contradictory response',
    inconsistent_accepted_nonexistent_hash: 'Nonexistent hash accepted',
    inconclusive_empty: 'No matching logs (inconclusive)',
    inconclusive_no_transaction: 'No transaction to test',
    inconclusive_no_contract: 'No contract to test',
    unavailable: 'Unavailable',
  };

  function node(tag, value, className) {
    const element = document.createElement(tag);
    if (value !== undefined) element.textContent = String(value);
    if (className) element.className = className;
    return element;
  }

  function nameOf(network) {
    return network.replaceAll('-', ' ').replace(/\b[a-z]/g, letter => letter.toUpperCase());
  }

  function observation(check) {
    const result = node('span', labels[check?.status] ?? check?.status ?? 'Not reported', 'rpc-outcome');
    if (check?.status === 'ok' || check?.status === 'rejected_unknown_hash') {
      result.classList.add('rpc-outcome-success');
    } else if (check?.status?.startsWith('inconclusive')) {
      result.classList.add('rpc-outcome-inconclusive');
    } else {
      result.classList.add('rpc-outcome-other');
    }
    return result;
  }

  function evidence(check) {
    const items = [];
    if (check?.code !== undefined) items.push('RPC ' + check.code);
    if (check?.ms !== undefined) items.push(check.ms + ' ms');
    if (check?.matches !== undefined) items.push(check.matches + ' logs');
    if (check?.receipts !== undefined) items.push(check.receipts + ' receipts');
    return items.join(' · ');
  }

  function groupOf(method) {
    if (method.includes('historical4096')) return 'Historical state (4,096 blocks)';
    if (method.startsWith('eth_getLogs')) return 'Event logs';
    if (/^eth_get(Transaction|BlockReceipts)/.test(method)) return 'Transactions and receipts';
    if (/^eth_(call|getCode|getStorageAt|getBalance)/.test(method)) return 'Block-addressed state';
    return 'Chain and blocks';
  }

  function methodDetails(service, methods) {
    const details = node('details', undefined, 'rpc-method-details');
    details.append(node('summary', 'All ' + methods.length + ' method observations'));
    const grouped = new Map();
    for (const method of methods) {
      const group = groupOf(method);
      if (!grouped.has(group)) grouped.set(group, []);
      grouped.get(group).push(method);
    }
    for (const [group, names] of grouped) {
      const section = node('section', undefined, 'rpc-method-group');
      const list = node('dl', undefined, 'rpc-method-list');
      section.append(node('h4', group));
      for (const method of names) {
        const check = service.checks?.[method];
        const row = node('div', undefined, 'rpc-method-row');
        const label = node('dt');
        label.append(node('code', method));
        const value = node('dd');
        value.append(observation(check));
        const detail = evidence(check);
        if (detail) value.append(node('small', detail, 'rpc-method-evidence'));
        row.append(label, value);
        list.append(row);
      }
      section.append(list);
      details.append(section);
    }
    return details;
  }

  function providerCard(name, service, methods) {
    const card = node('article', undefined, 'rpc-provider-card');
    const heading = node('div', undefined, 'rpc-provider-heading');
    heading.append(node('h4', name));
    const state = service.status === 'probed' ? 'Probed' :
      service.status === 'requires_api_key' ? 'API key required' : service.status;
    heading.append(node('span', state, 'rpc-provider-state'));
    card.append(heading);
    card.append(node('code', service.endpoint ?? service.endpoint_template ?? 'No endpoint recorded', 'rpc-provider-url'));

    if (service.status !== 'probed') {
      const message = service.status === 'requires_api_key' ?
        'Not contacted. No method-support conclusions can be drawn without provider credentials.' :
        'The endpoint did not complete the initial probe.';
      card.append(node('p', message, 'rpc-provider-note'));
      return card;
    }

    const keyResults = node('dl', undefined, 'rpc-key-results');
    for (const [label, method] of [
      ['Chain ID', 'eth_chainId'],
      ['Event logs by range', 'eth_getLogs:range'],
      ['Logs by block hash', 'eth_getLogs:blockHash'],
      ['Historical call · 4,096 blocks', 'eth_call:historical4096'],
    ]) {
      const item = node('div', undefined, 'rpc-key-result');
      const value = node('dd');
      value.append(observation(service.checks?.[method]));
      item.append(node('dt', label), value);
      keyResults.append(item);
    }
    card.append(keyResults, methodDetails(service, methods));
    return card;
  }

  async function load() {
    try {
      const response = await fetch(reportURL, { cache: 'no-store', signal: controller.signal });
      if (!response.ok) throw new Error('HTTP ' + response.status);
      const report = await response.json();
      if (report.schema !== 1 || report.state !== 'complete' || !report.summary ||
          !Array.isArray(report.method_checks) || !report.networks ||
          typeof report.networks !== 'object' || Array.isArray(report.networks)) {
        throw new Error('Unexpected measurement report');
      }
      const networks = Object.keys(report.networks);
      if (!networks.length) throw new Error('No networks in the report');
      if (controller.signal.aborted) return;

      networkChoice.replaceChildren(...networks.map(key => {
        const option = node('option', nameOf(key));
        option.value = key;
        return option;
      }));
      const preferred = new URL(location.href).searchParams.get('network');
      networkChoice.value = preferred && Object.hasOwn(report.networks, preferred) ? preferred : networks[0];

      function render() {
        const key = networkChoice.value;
        const network = report.networks[key];
        networkTitle.textContent = nameOf(key) + ' · chain ' + network.chain_id;
        providers.replaceChildren(...Object.entries(network.services).map(
          ([name, service]) => providerCard(name, service, report.method_checks)
        ));
      }

      networkChoice.addEventListener('change', render, { signal: controller.signal });
      render();
      summary.textContent = 'Measured ' + report.generated_at_utc + ' · ' +
        report.summary.networks + ' networks · ' + report.summary.endpoints + ' endpoints (' +
        report.summary.keyless + ' keyless, ' + report.summary.requires_api_key + ' requiring API keys).';
      const raw = node('a', 'Full measurement report (JSON)');
      raw.href = reportURL;
      source.replaceChildren(raw);
      results.hidden = false;
      status.textContent = 'Measurements loaded. Select a network to inspect its providers.';
    } catch (error) {
      if (!controller.signal.aborted) {
        status.textContent = 'Could not load RPC measurements: ' + error.message +
          '. Open the JSON report instead.';
      }
    }
  }

  void load();
  return () => controller.abort();
}
