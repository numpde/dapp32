/** Display the recorded RPC probe results without maintaining another catalog. */
export function mountCapabilities() {
  const status = document.querySelector('#capability-status');
  const summary = document.querySelector('#capability-summary');
  const source = document.querySelector('#capability-source');
  const results = document.querySelector('#capability-results');
  const rows = document.querySelector('#capability-rows');
  const controller = new AbortController();
  const url = `${import.meta.env.BASE_URL}deployment/rpc/capabilities.json`;

  function element(tag, value) {
    const node = document.createElement(tag);
    if (value !== undefined) node.textContent = String(value);
    return node;
  }

  function outcome(service, method) {
    if (service.status === 'requires_api_key') return 'Not tested (API key)';
    return service.checks?.[method]?.status ?? 'Not reported';
  }

  function methodsCell(service, methods) {
    const cell = element('td');
    if (service.status === 'requires_api_key') {
      cell.textContent = 'Not tested: an API key is required';
      return cell;
    }

    const details = element('details');
    details.append(element('summary', `${methods.length} method results`));
    const definitions = element('dl');

    for (const method of methods) {
      const check = service.checks?.[method];
      const extras = [];
      if (check?.code !== undefined) extras.push(`RPC code ${check.code}`);
      if (check?.ms !== undefined) extras.push(`${check.ms} ms`);
      if (check?.matches !== undefined) extras.push(`${check.matches} logs`);
      if (check?.receipts !== undefined) extras.push(`${check.receipts} receipts`);
      const description = outcome(service, method) + (extras.length ? ` · ${extras.join(', ')}` : '');
      definitions.append(element('dt', method), element('dd', description));
    }

    details.append(definitions);
    cell.append(details);
    return cell;
  }

  async function load() {
    try {
      const response = await fetch(url, { cache: 'no-store', signal: controller.signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const report = await response.json();
      if (report.schema !== 1 || report.state !== 'complete' || !report.summary
          || !Array.isArray(report.method_checks) || !report.networks
          || typeof report.networks !== 'object' || Array.isArray(report.networks)) {
        throw new Error('Unexpected report format');
      }

      const records = document.createDocumentFragment();
      for (const [networkName, network] of Object.entries(report.networks)) {
        for (const [provider, service] of Object.entries(network.services)) {
          const row = element('tr');
          const networkCell = element('th', networkName);
          networkCell.scope = 'row';
          networkCell.append(element('small', `Chain ${network.chain_id}`));
          const providerCell = element('td');
          providerCell.append(element('strong', provider),
                              element('code', service.endpoint ?? service.endpoint_template ?? ''));

          row.append(networkCell, providerCell);
          row.append(element('td', outcome(service, 'eth_chainId')));
          row.append(element('td', `${outcome(service, 'eth_getLogs:range')} / ${outcome(service, 'eth_getLogs:blockHash')}`));
          row.append(element('td', `${outcome(service, 'eth_call:blockHash')} / ${outcome(service, 'eth_call:historical4096')}`));
          row.append(methodsCell(service, report.method_checks));
          records.append(row);
        }
      }

      if (controller.signal.aborted) return;
      rows.replaceChildren(records);
      summary.textContent = `Recorded ${report.generated_at_utc}: ${report.summary.networks} networks, ${report.summary.endpoints} endpoints; ${report.summary.keyless} keyless and ${report.summary.requires_api_key} requiring credentials. Chain ID verified for ${report.summary.chain_verified} endpoints.`;
      const raw = element('a', 'Full machine-readable results (JSON)');
      raw.href = url;
      source.replaceChildren(raw);
      results.hidden = false;
      status.textContent = 'Measurements loaded. Expand a provider to inspect every method.';
    } catch (error) {
      if (controller.signal.aborted) return;
      const raw = element('a', 'Open the recorded JSON');
      raw.href = url;
      source.replaceChildren(raw);
      status.textContent = `Could not load RPC measurements: ${error.message}. Reload the page or open the JSON.`;
    }
  }

  void load();
  return () => controller.abort();
}
