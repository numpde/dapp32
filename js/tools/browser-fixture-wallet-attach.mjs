// Foreground local-fixture signer for one operator-selected existing browser tab.
import assert from 'node:assert/strict'
import { createPublicClient, createWalletClient, http, parseAbi } from 'viem'
import { requireHttpURL, requireSameHttpOrigin, readBoundedResponseBytes } from '@cam/protocol'
import { viewerErrorMessage } from '@cam/viewer'
import { collectFixtureFacts } from './browser-fixture-facts.mjs'
import { assertFixtureWalletDeployment, verifyFixtureWalletDeployment, fixtureWalletTransaction, fixtureWalletAccounts, fixtureWalletSource, installFixtureWalletInTarget, fixtureDocumentRequest, awaitFixtureSocketOpen, finishFixtureAttachment } from './browser-fixture-wallet.mjs'
import { createCdpCommands, submitFixtureTransaction } from '../apps/cam-web/test/escrow-browser-fixture.mjs'

let phase = 'validating app account configuration'
async function main() {
  const app = process.env.FIXTURE_WALLET_APP
  assert(['pay-to-play', 'escrow', 'bike-nft'].includes(app), 'FIXTURE_WALLET_APP must select an explicit app fixture')
  const config = (await import(`../apps/cam-web/test/${app}-fixture-wallet.mjs`)).default
  let accounts
  try { accounts = fixtureWalletAccounts(config.accounts) } catch (error) { process.stderr.write(`Cannot configure the fixture wallet: ${error.message}\n`); process.exitCode = 1; return }
  phase = 'validating the pinned local deployment'
  assert(Object.hasOwn(accounts, config.initialRole), 'Initial fixture account is missing')
  function localURL(value, name) {
    const url = requireHttpURL(value, name)
    assert(url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname), `${name} must use loopback HTTP`)
    return url
  }
  const viewer = localURL(process.env.VIEWER_URL, 'VIEWER_URL')
  const cdp = localURL(process.env.CDP_ORIGIN, 'CDP_ORIGIN')
  assert(cdp.pathname === '/' && !cdp.search && !cdp.hash, 'CDP_ORIGIN must be an origin')
  assert.equal(viewer.searchParams.get('chainId'), 'eip155:31337')
  const root = viewer.searchParams.get('host')
  assert(/^0x[0-9a-fA-F]{40}$/.test(root), 'VIEWER_URL must name a CAM host')
  const expectedContracts = JSON.parse(process.env.EXPECTED_CONTRACT_ADDRESSES)
  const targetId = process.env.CDP_TARGET_ID
  assert(/^[A-Fa-f0-9]{32}$/.test(targetId), 'CDP_TARGET_ID must select one existing tab')
  const rpcURL = localURL(viewer.searchParams.get('rpcUrl'), 'Viewer RPC')
  requireSameHttpOrigin(rpcURL.href, viewer.origin, 'Viewer RPC')
  async function bytes(url) {
    const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(10000) })
    assert(response.ok, 'Fixture HTTP request failed')
    return new Uint8Array(await readBoundedResponseBytes(response, String(url), 1048576))
  }
  const chain = { id: 31337, name: 'Local fixture', nativeCurrency: { name: 'Native asset', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: [rpcURL.href] } } }
  const publicClient = createPublicClient({ chain, transport: http(rpcURL.href, { timeout: 10000, retryCount: 0 }) })
  async function assertChain() { assert.equal(await publicClient.getChainId(), 31337, 'RPC must remain fixture chain 31337') }
  await assertChain()
  const rootABI = parseAbi(['function camManifest() view returns ((string uri,bytes32 sha256Digest))', 'function contractAddress(string) view returns (address)'])
  const readManifest = () => publicClient.readContract({ address: root, abi: rootABI, functionName: 'camManifest' })
  const readBinding = namespace => publicClient.readContract({ address: root, abi: rootABI, functionName: 'contractAddress', args: [namespace] })
  const expectedManifest = { uri: process.env.EXPECTED_CAM_URI, sha256Digest: process.env.EXPECTED_CAM_HASH }
  const grants = await verifyFixtureWalletDeployment({ config, expectedContracts, manifest: await readManifest(), expectedManifest, origin: viewer.origin, readBytes: bytes, readBinding, readCode: address => publicClient.getCode({ address }) })
  const inspectionContracts = Object.fromEntries(Object.entries(expectedContracts).map(([name, address]) => [name, { address, abi: grants.get(address.toLowerCase()).inspectionABI }]))
  const wallets = Object.fromEntries(Object.entries(accounts).map(([name, account]) => [name, createWalletClient({ account, chain, transport: http(rpcURL.href, { timeout: 10000, retryCount: 0 }) })]))
  phase = 'connecting to the selected existing browser tab'
  const version = JSON.parse(new TextDecoder().decode(await bytes(new URL('/json/version', cdp))))
  const socketURL = new URL(version.webSocketDebuggerUrl)
  assert.equal(socketURL.protocol, 'ws:'); assert.equal(socketURL.host, cdp.host)
  assert(!socketURL.username && !socketURL.password)
  const socket = new WebSocket(socketURL)
  await awaitFixtureSocketOpen(socket, 10000)
  const commands = createCdpCommands({ socket, now: Date.now, runDeadline: Infinity })
  let session
  let installed
  let primaryFailure
  let stop
  const stopped = new Promise(resolve => { stop = resolve })
  process.once('SIGINT', () => stop()); process.once('SIGTERM', () => stop())
  socket.addEventListener('close', () => stop(), { once: true })
  let open = true
  let busy = false
  const pending = new Set()
  const documents = new Map()
  const call = (method, params, purpose) => commands.call(method, params, method.startsWith('Target.') ? undefined : session, purpose)
  async function assertTab() {
    const info = (await call('Target.getTargetInfo', { targetId })).targetInfo
    const url = new URL(info.url)
    assert.equal(url.origin, viewer.origin); assert.equal(url.searchParams.get('host')?.toLowerCase(), root.toLowerCase()); assert.equal(url.searchParams.get('chainId'), 'eip155:31337')
  }
  async function bridge(request, executionContextId) {
    const document = fixtureDocumentRequest({ executionContextId, documents, isOpen: () => open, call })
    let result
    let ok = false
    let ownsSubmission = false
    let submissionStarted = false
    try {
      assert(document.shouldContinue() && !busy, 'Fixture wallet document is stopped or submitting')
      assert.equal(request.method, 'eth_sendTransaction')
      assert(Object.hasOwn(accounts, request.role), 'Unknown fixture account')
      assert.equal(request.params.length, 1)
      const account = accounts[request.role]
      const tx = request.params[0]
      const transaction = fixtureWalletTransaction({ tx, account, chain, config, grants })
      busy = true; ownsSubmission = true
      await assertTab()
      submissionStarted = true
      result = await submitFixtureTransaction({ wallet: wallets[request.role], publicClient, transaction, assertChain: async () => {
        await assertTab(); await assertChain()
        await assertFixtureWalletDeployment({ manifest: await readManifest(), expectedManifest, expectedContracts, readBinding })
      }, shouldContinue: document.shouldContinue })
      if (result === undefined) return
      ok = true
    } catch { result = { code: -32603, message: submissionStarted ? 'Local fixture submission failed; it may have been broadcast. Check chain state before retrying.' : 'Transaction rejected by the local fixture grant; nothing was submitted.' } }
    finally { if (ownsSubmission) busy = false }
    await document.resolve(request.id, ok, result)
  }
  async function inspect(request, executionContextId) {
    const document = fixtureDocumentRequest({ executionContextId, documents, isOpen: () => open, call })
    try {
      assert(document.shouldContinue(), 'Fixture document is no longer active')
      assert.equal(request.method, 'fixture_facts')
      assert.deepEqual(request.params, [])
      assert(Object.hasOwn(accounts, request.role), 'Unknown fixture account')
      await assertTab(); await assertChain()
      await assertFixtureWalletDeployment({ manifest: await readManifest(), expectedManifest, expectedContracts, readBinding })
      const facts = await collectFixtureFacts({ client: publicClient, config, contracts: inspectionContracts, account: accounts[request.role].address })
      await document.resolve(request.id, true, facts)
    } catch (error) {
      await document.resolve(request.id, false, { code: -32603, message: 'Cannot load deployment facts. Check the local fixture and try Refresh.', diagnostic: viewerErrorMessage(error) })
    }
  }
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data)
    if (message.id) { commands.receive(message); return }
    if (message.sessionId === session) {
      if (message.method === 'Runtime.executionContextCreated' && message.params.context.auxData?.isDefault === true) documents.set(message.params.context.id, message.params.context)
      if (message.method === 'Runtime.executionContextDestroyed') documents.delete(message.params.executionContextId)
      if (message.method === 'Runtime.executionContextsCleared') documents.clear()
    }
    if (message.method === 'Target.detachedFromTarget' && message.params.sessionId === session) { stop(); return }
    if (message.sessionId !== session || message.method !== 'Runtime.bindingCalled' || message.params.name !== 'fixtureWalletBridge') return
    const request = JSON.parse(message.params.payload)
    const task = request.method === 'fixture_facts' ? inspect(request, message.params.executionContextId) : bridge(request, message.params.executionContextId)
    pending.add(task); task.finally(() => pending.delete(task)).catch(() => {})
  })
  try {
    await assertTab()
    session = (await call('Target.attachToTarget', { targetId, flatten: true })).sessionId
    await call('Page.enable', {}); await call('Runtime.enable', {})
    phase = 'installing the fixture provider (an existing wallet must be removed first)'
    try { installed = await installFixtureWalletInTarget(call, fixtureWalletSource({ accounts: Object.fromEntries(Object.entries(accounts).map(([name, account]) => [name, account.address])), initialRole: config.initialRole, origin: viewer.origin, host: root, confirmTransactions: true, deploymentFacts: true })) } catch (installationFailure) {
      if (installationFailure instanceof AggregateError) process.stderr.write(installationFailure.message+'\n')
      throw installationFailure
    }
    await call('Page.reload', { ignoreCache: true })
    const until = Date.now() + 10000
    let ready = false
    while (Date.now() < until && !ready) {
      const state = await call('Runtime.evaluate', { expression: '!!window.__fixtureWallet && window.ethereum === window.__fixtureWallet.provider && !!document.getElementById("local-fixture-wallet")', returnByValue: true })
      ready = state.result?.value === true
      if (!ready) await new Promise(resolve => setTimeout(resolve, 100))
    }
    assert(ready, 'Fixture provider did not install after reload')
    phase = 'maintaining the fixture attachment'
    process.stdout.write(JSON.stringify({ event: 'fixture_wallet_attached', targetId, app, initialRole: config.initialRole, reload: 'Reconnect the app wallet after reload; selection resets to the configured initial account.', stop: 'Ctrl-C removes the selector and provider without closing the tab.' })+'\n')
    await stopped
  } catch (failure) {
    primaryFailure = failure
  } finally {
    await finishFixtureAttachment({ stopSubmissions: () => { open = false }, wallet: installed, pending, commands, socket, primaryFailure })
  }
}
main().catch(failure => {
  if (failure instanceof AggregateError) process.stderr.write(failure.message+'\n')
  process.stderr.write(`Cannot maintain the local fixture wallet during ${phase}. Verify the selected tab and pinned local deployment.\n`)
  process.exitCode = 1
})
