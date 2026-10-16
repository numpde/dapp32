import { privateKeyToAccount } from 'viem/accounts'

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
  const browserOptions = { accounts: options.accounts, initialRole: options.initialRole, origin: options.origin, host: options.host, confirmTransactions: options.confirmTransactions }
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
      if (options.confirmTransactions && !confirm(`LOCAL FIXTURE: send immediately from ${role} on chain 31337? No extension wallet is involved.`)) throw failure('Fixture transaction cancelled', 4001)
      const id = ++next
      const requestedRole = role
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject })
        try { window.fixtureWalletBridge(JSON.stringify({ id, role: requestedRole, method, params })) } catch { pending.delete(id); reject(failure('Fixture wallet bridge unavailable', 4900)) }
      })
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
      else request.reject(failure(value.message, value.code))
    },
    shutdown() {
      if (closed) return
      closed = true
      for (const request of pending.values()) request.reject(failure('Fixture wallet stopped', 4900))
      pending.clear()
      emit('accountsChanged', [])
      listeners.clear()
      document.getElementById('local-fixture-wallet')?.remove()
      if (window.ethereum === provider) delete window.ethereum
      if (window.__fixtureWallet === owner) delete window.__fixtureWallet
    },
  }
  window.ethereum = provider
  window.__fixtureWallet = owner
  function toolbar() {
    if (closed) return
    const bar = document.createElement('aside')
    bar.id = 'local-fixture-wallet'
    bar.style.cssText = 'position:sticky;top:0;z-index:2147483647;background:#fff3c4;color:#242424;border:2px solid #826000;padding:10px;font:14px/1.4 system-ui;display:flex;gap:12px;align-items:center;flex-wrap:wrap'
    const label = document.createElement('label')
    label.textContent = 'Local fixture wallet · chain 31337 · account '
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
    explanation.textContent = options.confirmTransactions ? 'Public test accounts. Confirming a send submits immediately. Not an extension wallet.' : 'Automated local fixture. Sends are handled by the test process.'
    bar.append(label, accountLabel, explanation)
    document.body.prepend(bar)
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', toolbar, { once: true })
  else toolbar()
}

// The caller owns the CDP session and tab. Disposing releases only our injection.
export async function installFixtureWalletInTarget(call, source) {
  const existing = await call('Runtime.evaluate', { expression: 'window.ethereum !== undefined', returnByValue: true })
  if (existing.exceptionDetails || existing.result.value !== false) throw new Error('A wallet is already installed in this tab')
  await call('Runtime.addBinding', { name: 'fixtureWalletBridge' })
  const registration = await call('Page.addScriptToEvaluateOnNewDocument', { source })
  return {
    async dispose() {
      await call('Page.removeScriptToEvaluateOnNewDocument', { identifier: registration.identifier })
      await call('Runtime.evaluate', { expression: 'window.__fixtureWallet?.shutdown()', awaitPromise: true })
      await call('Runtime.removeBinding', { name: 'fixtureWalletBridge' })
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
