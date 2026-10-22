import { privateKeyToAccount } from 'viem/accounts'
import assert from 'node:assert/strict'
import { decodeFunctionData, encodeFunctionData, sha256, toFunctionSelector, toFunctionSignature } from 'viem'
import { requireSameHttpOrigin } from '@cam/protocol'

export function fixtureFunctionSelectors(abi, configuredNames) {
  const configured = new Set()
  const selectors = new Set()
  for (const name of configuredNames) {
    if (configured.has(name)) throw new Error(`Fixture function grant repeats ${name}`)
    configured.add(name)

    const matches = abi.filter(item => item.type === 'function' && (name.includes('(') ? toFunctionSignature(item) === name : item.name === name))
    if (matches.length !== 1) throw new Error(`Fixture ABI must declare granted function ${name} exactly once`)
    if (!['payable', 'nonpayable'].includes(matches[0].stateMutability)) throw new Error(`Fixture function ${name} must be a write`)

    const selector = toFunctionSelector(matches[0])
    if (selectors.has(selector)) throw new Error(`Fixture ABI granted function ${name} shares a selector`)
    selectors.add(selector)
  }
  return selectors
}

// Recheck the pinned authority before signing and broadcasting; never refresh grants.
export async function assertFixtureWalletDeployment({ manifest, expectedManifest, expectedContracts, readBinding }) {
  assert.equal(manifest.uri, expectedManifest.uri, 'CAM manifest URI changed')
  assert.equal(manifest.sha256Digest.toLowerCase(), expectedManifest.sha256Digest.toLowerCase(), 'CAM manifest hash changed')
  for (const [namespace, address] of Object.entries(expectedContracts)) {
    assert.equal((await readBinding(namespace)).toLowerCase(), address.toLowerCase(), `CAM binding for ${namespace} must match its explicit target`)
  }
}

export async function verifyFixtureWalletDeployment({ config, expectedContracts, manifest, expectedManifest, origin, readBytes, readBinding, readCode }) {
  assert.deepEqual(Object.keys(expectedContracts).sort(), Object.keys(config.contracts).sort(), 'Contract pins must exactly match fixture grants')
  const addresses = new Set()
  for (const address of Object.values(expectedContracts)) {
    assert(typeof address === 'string' && /^0x[0-9a-fA-F]{40}$/.test(address) && !/^0x0{40}$/.test(address), 'Contract pins must be nonzero addresses')
    assert(!addresses.has(address.toLowerCase()), 'Fixture targets must have distinct addresses')
    addresses.add(address.toLowerCase())
  }
  await assertFixtureWalletDeployment({ manifest, expectedManifest, expectedContracts, readBinding })
  requireSameHttpOrigin(manifest.uri, origin, 'CAM manifest')
  const manifestBytes = await readBytes(manifest.uri)
  assert.equal(sha256(manifestBytes), manifest.sha256Digest.toLowerCase(), 'CAM manifest bytes must match its hash')
  const cam = JSON.parse(new TextDecoder().decode(manifestBytes))
  const grants = new Map()
  for (const [namespace, functions] of Object.entries(config.contracts)) {
    const address = expectedContracts[namespace]
    const declaration = cam.namespaces[`contracts.${namespace}`]
    assert.equal(declaration.type, 'contract', 'Granted namespace must declare a contract')
    const abiURL = new URL(declaration.abiURI, manifest.uri)
    requireSameHttpOrigin(abiURL.href, origin, 'App ABI')
    const abiBytes = await readBytes(abiURL.href)
    assert.equal('sha256:'+sha256(abiBytes), declaration.integrity, 'App ABI bytes must match their integrity')
    const abi = JSON.parse(new TextDecoder().decode(abiBytes))
    const selectors = fixtureFunctionSelectors(abi, functions)
    const code = await readCode(address)
    assert(typeof code === 'string' && /^0x(?:[0-9a-fA-F]{2})+$/.test(code), 'Fixture target must contain deployed code')
    const grantedABI = abi.filter(item => item.type === 'function' && functions.some(name => name.includes('(') ? toFunctionSignature(item) === name : item.name === name))
    const inspectionABI = abi.filter(item => item.type === 'event' || item.type === 'function' && ['view', 'pure'].includes(item.stateMutability))
    grants.set(address.toLowerCase(), { address, abi: grantedABI, selectors, inspectionABI })
  }
  return grants
}

export function fixtureWalletTransaction({ tx, account, chain, config, grants }) {
  assert(Object.keys(tx).every(key => ['from', 'to', 'data', 'value', 'gas'].includes(key)), 'Unsupported fixture transaction field')
  assert.equal(tx.from.toLowerCase(), account.address.toLowerCase(), 'Transaction must use the selected fixture account')
  const grant = grants.get(tx.to.toLowerCase())
  assert(grant !== undefined, 'Transaction target is not granted')
  assert(typeof tx.data === 'string' && /^0x(?:[0-9a-fA-F]{2})+$/.test(tx.data) && tx.data.length <= config.maxCalldataHexLength && grant.selectors.has(tx.data.slice(0, 10).toLowerCase()), 'Transaction calldata is not granted')
  const decoded = decodeFunctionData({ abi: grant.abi, data: tx.data })
  assert.equal(encodeFunctionData({ abi: grant.abi, ...decoded }).toLowerCase(), tx.data.toLowerCase(), 'Transaction calldata must be complete and canonical')
  const value = tx.value === undefined ? 0n : BigInt(tx.value)
  assert(value >= 0n && value <= config.maxValue, 'Transaction value exceeds the fixture grant')
  const payable = grant.abi.some(item => item.type === 'function' && toFunctionSelector(item) === tx.data.slice(0, 10).toLowerCase() && item.stateMutability === 'payable')
  assert(value === 0n || payable, 'Nonpayable fixture calls cannot send value')
  if (tx.gas !== undefined) assert(BigInt(tx.gas) > 0n && BigInt(tx.gas) <= config.maxGas, 'Transaction gas exceeds the fixture grant')
  return { account, chain, to: grant.address, data: tx.data, value, gas: config.maxGas }
}

// Keys belong to the fixture process. The injected provider receives addresses only.
export function fixtureWalletAccounts(namedAccounts) {
  const accounts = {}
  for (const [name, supplied] of Object.entries(namedAccounts)) {
    let account
    try { account = privateKeyToAccount(supplied.privateKey) } catch { throw new Error(`Fixture account ${name} has an invalid private key`) }
    if (typeof supplied.address !== 'string' || account.address.toLowerCase() !== supplied.address.toLowerCase()) throw new Error(`Fixture account ${name} address does not match its private key`)
    accounts[name] = account
  }
  if (Object.keys(accounts).length === 0) throw new Error('Fixture wallet needs at least one named account')
  return accounts
}

export function fixtureWalletSource(options) {
  for (const address of Object.values(options.accounts)) {
    if (typeof address !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(address)) throw new Error('Browser fixture accounts must contain addresses only')
  }
  const browserOptions = { accounts: options.accounts, initialRole: options.initialRole, origin: options.origin, host: options.host, confirmTransactions: options.confirmTransactions, deploymentFacts: options.deploymentFacts === true }
  return `(${installFixtureWallet.toString()})(${JSON.stringify(browserOptions)})`
}

function installFixtureWallet(options) {
  const here = new URL(location.href)
  if (here.origin !== options.origin) return
  if (here.searchParams.get('host')?.toLowerCase() !== options.host.toLowerCase()) return
  if (here.searchParams.get('chainId') !== 'eip155:31337') return
  if (window.ethereum !== undefined) throw new Error('A wallet is already installed in this tab')
  const addresses = options.accounts
  if (!Object.hasOwn(addresses, options.initialRole)) throw new Error('Unknown initial fixture account')
  let role = options.initialRole
  let connected = true
  let chainId = '0x7a69'
  let closed = false
  let next = 0
  const pending = new Map()
  const listeners = new Map()
  let select
  let accountLabel
  let factsPanel
  let factsContent
  let factsRefresh
  let factsRevision = 0
  const failure = (message, code) => Object.assign(new Error(message), { code })
  function emit(event, value) {
    const subscribers = listeners.get(event)
    if (subscribers !== undefined) for (const subscriber of [...subscribers]) subscriber(value)
  }
  function setRole(name) {
    if (closed) throw failure('Fixture wallet stopped', 4900)
    if (!Object.hasOwn(addresses, name)) throw failure('Unknown fixture account', 4200)
    if (role === name && connected) return
    role = name
    connected = true
    if (select !== undefined) select.value = role
    if (accountLabel !== undefined) accountLabel.textContent = addresses[role]
    emit('accountsChanged', [addresses[role]])
    if (factsPanel?.open) void refreshFacts()
  }
  function requestBridge(method, params) {
    const id = ++next
    const requestedRole = role
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject })
      try { window.fixtureWalletBridge(JSON.stringify({ id, role: requestedRole, method, params })) } catch { pending.delete(id); reject(failure('Fixture wallet bridge unavailable', 4900)) }
    })
  }
  function element(tag, text) {
    const node = document.createElement(tag)
    node.textContent = text
    return node
  }
  function renderFacts(facts) {
    const status = element('p', `Checked at block ${facts.blockNumber}. ${facts.rows.length} records. ${facts.description}`)
    status.setAttribute('role', 'status')
    factsContent.replaceChildren(element('h3', facts.title), status)
    if (facts.scope !== undefined) factsContent.append(element('p', facts.scope))
    if (facts.rows.length === 0) factsContent.append(element('p', 'No records found in this search.'))
    for (const row of facts.rows) {
      const item = document.createElement('section')
      item.append(element('strong', row.label))
      for (const value of row.values) item.append(element('p', value))
      const link = element('a', row.linkLabel)
      link.href = '#' + new URLSearchParams({ route: row.route, ...row.inputs }).toString()
      item.append(link)
      factsContent.append(item)
    }
  }
  async function refreshFacts() {
    if (closed || !factsPanel.open) return
    const revision = ++factsRevision
    factsRefresh.disabled = true
    const loading = element('p', 'Loading deployment facts…')
    loading.setAttribute('role', 'status')
    factsContent.replaceChildren(loading)
    try {
      const facts = await requestBridge('fixture_facts', [])
      if (!closed && revision === factsRevision) renderFacts(facts)
    } catch (error) {
      if (closed || revision !== factsRevision) return
      const report = document.createElement('div')
      report.className = 'fixture-facts-error'
      report.setAttribute('role', 'alert')
      report.append(element('p', error.message))
      if (typeof error.diagnostic === 'string' && error.diagnostic !== error.message) report.append(element('code', error.diagnostic))
      factsContent.replaceChildren(report)
    } finally {
      if (!closed && revision === factsRevision) factsRefresh.disabled = false
    }
  }
  const provider = {
    request: async ({ method, params }) => {
      if (closed) throw failure('Fixture wallet stopped', 4900)
      if (method === 'eth_requestAccounts') { connected = true; return [addresses[role]] }
      if (method === 'eth_accounts') return connected ? [addresses[role]] : []
      if (method === 'eth_chainId') return chainId
      if (method === 'wallet_switchEthereumChain' && params?.[0]?.chainId === '0x7a69') { owner.setChain('0x7a69'); return null }
      if (method !== 'eth_sendTransaction') throw failure('Unsupported fixture wallet method', 4200)
      if (chainId !== '0x7a69') throw failure('Fixture wallet is not on chain 31337', 4901)
      if (!connected || params?.length !== 1 || params[0]?.from?.toLowerCase() !== addresses[role].toLowerCase()) throw failure('Transaction must use the selected fixture account', -32602)
      if (options.confirmTransactions && !confirm(`Send this local test transaction as ${role} on chain 31337? Confirming submits it immediately.`)) throw failure('Fixture transaction cancelled', 4001)
      return requestBridge(method, params)
    },
    on(event, fn) { if (!listeners.has(event)) listeners.set(event, new Set()); listeners.get(event).add(fn); return provider },
    removeListener(event, fn) { listeners.get(event)?.delete(fn); return provider },
  }
  const owner = {
    provider, setRole,
    setChain(nextChain) { if (chainId !== nextChain) { chainId = nextChain; emit('chainChanged', chainId) } },
    disconnect() { connected = false; emit('accountsChanged', []) },
    resolve(id, ok, value) {
      const request = pending.get(id)
      if (request === undefined) return
      pending.delete(id)
      if (ok) request.resolve(value)
      else request.reject(Object.assign(failure(value.message, value.code), { diagnostic: value.diagnostic, data: value.data }))
    },
    shutdown() {
      if (closed) return
      closed = true
      factsRevision++
      for (const request of pending.values()) request.reject(failure('Fixture wallet stopped', 4900))
      pending.clear()
      try { emit('accountsChanged', []) } finally {
        listeners.clear()
        document.getElementById('local-fixture-wallet')?.remove()
        if (window.ethereum === provider) delete window.ethereum
        if (window.__fixtureWallet === owner) delete window.__fixtureWallet
      }
    },
  }
  window.ethereum = provider
  window.__fixtureWallet = owner
  function toolbar() {
    if (closed) return
    const bar = document.createElement('aside')
    bar.id = 'local-fixture-wallet'
    bar.style.cssText = 'flex:0 1 auto;min-height:0;margin:0;box-sizing:border-box;background:#fff3c4;color:#242424;border:0;border-bottom:2px solid #826000;padding:10px 16px;font:14px/1.4 system-ui;display:grid;grid-template-rows:auto minmax(0,1fr);gap:12px'
    const layout = document.createElement('style')
    layout.textContent = `
      html { overflow: hidden; }
      body { margin: 0; height: 100dvh; overflow: hidden; display: flex; flex-direction: column; }
      body > #root { flex: 1 0 3rem; min-height: 0; min-width: 0; overflow: auto; overscroll-behavior: contain; }
      #local-fixture-wallet .wallet-controls { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; min-width: 0; }
      #local-fixture-facts { min-width: 0; min-height: 0; max-height: 40dvh; overflow: auto; overscroll-behavior: contain; }
      #local-fixture-facts summary { cursor: pointer; }
      #local-fixture-facts section { border-top: 1px solid #b9a777; padding-block: 8px; }
      #local-fixture-facts p { margin-block: 4px; }
      #local-fixture-facts code, #local-fixture-facts p, #local-fixture-facts strong { overflow-wrap: anywhere; }
      #local-fixture-facts a { color: #154e83; }
      #local-fixture-facts h3 { font-size: 1em; margin-block: 8px; }
      #local-fixture-facts .fixture-facts-error { border-inline-start: 3px solid #a32424; padding: 8px 12px; background: #fff4f0; }
      #local-fixture-facts .fixture-facts-error code { display: block; font-size: 0.875em; margin-block-start: 8px; }
    `
    const label = document.createElement('label')
    label.textContent = 'Local test wallet · chain 31337 · account '
    select = document.createElement('select')
    select.id = 'local-fixture-wallet-role'
    for (const name of Object.keys(addresses)) { const option = document.createElement('option'); option.value = name; option.textContent = name; select.append(option) }
    select.value = role
    select.onchange = () => setRole(select.value)
    label.append(select)
    accountLabel = document.createElement('code')
    accountLabel.textContent = addresses[role]
    accountLabel.style.cssText = 'overflow-wrap:anywhere;min-width:0;max-width:100%'
    const explanation = document.createElement('span')
    explanation.textContent = options.confirmTransactions ? 'Public test accounts. Confirming a send submits immediately on this local chain.' : 'Local test accounts. The test process submits transactions.'
    const controls = document.createElement('div')
    controls.className = 'wallet-controls'
    controls.append(label, accountLabel, explanation)
    bar.append(layout, controls)
    if (options.deploymentFacts) {
      factsPanel = document.createElement('details')
      factsPanel.id = 'local-fixture-facts'
      factsRefresh = element('button', 'Refresh')
      factsRefresh.type = 'button'
      factsRefresh.onclick = () => { void refreshFacts() }
      factsContent = document.createElement('div')
      const scroll = document.createElement('div')
      scroll.append(factsRefresh, factsContent)
      factsPanel.append(element('summary', 'Local deployment'), scroll)
      factsPanel.ontoggle = () => {
        if (factsPanel.open) void refreshFacts()
        else { factsRevision++; factsContent.replaceChildren(); factsRefresh.disabled = false }
      }
      bar.append(factsPanel)
    }
    document.body.prepend(bar)
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', toolbar, { once: true })
  else toolbar()
}

// The caller owns the CDP session and tab. Disposing releases only our injection.
export async function installFixtureWalletInTarget(call, source) {
  const existing = await call('Runtime.evaluate', { expression: 'window.ethereum !== undefined', returnByValue: true })
  if (existing.exceptionDetails || existing.result.value !== false) throw new Error('A wallet is already installed in this tab')
  let registration
  let installing = 'Runtime.addBinding'
  try {
    await call('Runtime.addBinding', { name: 'fixtureWalletBridge' })
    installing = 'Page.addScriptToEvaluateOnNewDocument'
    registration = await call(installing, { source })
  } catch (initializationFailure) {
    const failures = [initializationFailure]
    let outcome = 'binding removal completed'
    try { await call('Runtime.removeBinding', { name: 'fixtureWalletBridge' }) } catch (cleanupFailure) {
      failures.push(cleanupFailure)
      outcome = 'binding removal also failed'
    }
    throw new AggregateError(failures, `Cannot install the fixture wallet: ${installing} failed; ${outcome}`)
  }
  return {
    async dispose() {
      const failures = []
      const failedOperations = []
      for (const [method, params] of [
        ['Page.removeScriptToEvaluateOnNewDocument', { identifier: registration.identifier }],
        ['Runtime.evaluate', { expression: 'window.__fixtureWallet?.shutdown()', awaitPromise: true }],
        ['Runtime.removeBinding', { name: 'fixtureWalletBridge' }],
      ]) {
        try {
          const result = await call(method, params)
          if (method === 'Runtime.evaluate' && result.exceptionDetails !== undefined) throw new Error('Fixture wallet shutdown raised an exception in the browser')
        } catch (failure) { failures.push(failure); failedOperations.push(method) }
      }
      if (failures.length !== 0) throw new AggregateError(failures, `Cannot fully detach the fixture wallet: ${failedOperations.join(', ')} failed`)
    },
  }
}

// Request IDs restart on reload; replies and submission checkpoints belong to
// the initiating execution context, never the tab's replacement document.
export function fixtureDocumentRequest({ executionContextId, documents, isOpen, call }) {
  const initiatingDocument = documents.get(executionContextId)
  const shouldContinue = () => isOpen() && initiatingDocument !== undefined && documents.get(executionContextId) === initiatingDocument
  return {
    shouldContinue,
    async resolve(id, ok, value) {
      if (shouldContinue()) await call('Runtime.evaluate', { contextId: executionContextId, expression: `window.__fixtureWallet?.resolve(${JSON.stringify(id)},${ok},${JSON.stringify(value)})` })
    },
  }
}


// Initialization owns the connecting socket until its handshake succeeds.
export function awaitFixtureSocketOpen(socket, timeoutMs) {
  return new Promise((resolve, reject) => {
    let settled = false
    const timer = setTimeout(() => fail('CDP connection timed out'), timeoutMs)
    function releaseListeners() {
      clearTimeout(timer)
      socket.removeEventListener('open', opened)
      socket.removeEventListener('error', failed)
      socket.removeEventListener('close', closed)
    }
    function opened() {
      if (settled) return
      settled = true
      releaseListeners()
      resolve()
    }
    function fail(message) {
      if (settled) return
      settled = true
      releaseListeners()
      const failure = new Error(message)
      try { socket.close() } catch (closeFailure) {
        reject(new AggregateError([failure, closeFailure], 'Cannot close the failed CDP connection'))
        return
      }
      reject(failure)
    }
    function failed() { fail('CDP connection failed') }
    function closed() { fail('CDP connection closed before opening') }
    socket.addEventListener('open', opened)
    socket.addEventListener('error', failed)
    socket.addEventListener('close', closed)
  })
}


// Finalization owns the broadcast gate, installed wallet and both transports.
export async function finishFixtureAttachment({ stopSubmissions, wallet, pending, commands, socket, primaryFailure }) {
  stopSubmissions()
  const failures = []
  const failedOperations = []
  if (primaryFailure !== undefined) failures.push(primaryFailure)
  if (wallet !== undefined) {
    try { await wallet.dispose() } catch (failure) { failures.push(failure); failedOperations.push('wallet disposal') }
  }
  try { commands.close() } catch (failure) { failures.push(failure); failedOperations.push('CDP command closure') }
  try { socket.close() } catch (failure) { failures.push(failure); failedOperations.push('socket closure') }
  await Promise.allSettled([...pending])
  if (failures.length !== 0) {
    let message = 'Fixture attachment failed'
    if (failedOperations.length !== 0) message += `; cleanup failed during ${failedOperations.join(', ')}. Reload the tab before reattaching`
    throw new AggregateError(failures, message)
  }
}
