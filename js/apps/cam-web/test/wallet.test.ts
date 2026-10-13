import assert from "node:assert/strict"
import test from "node:test"

import { ensureConnectedWalletAccount, ensureInjectedWalletChain, subscribeInjectedWallet, walletChain } from "../src/wallet.ts"

const ACCOUNT = "0x0000000000000000000000000000000000000001"
const OTHER_ACCOUNT = "0x0000000000000000000000000000000000000002"
const CHAIN_OPTIONS = {
  chainId: "eip155:31337",
  rpcUrl: "http://127.0.0.1:8545",
}

test("wallet events validate account and chain changes without requesting a wallet switch", () => {
  const provider = eventProvider()
  const changes: unknown[] = []
  const failures: unknown[] = []
  const unsubscribe = subscribeInjectedWallet(change => changes.push(change), error => failures.push(error))

  provider.emit("accountsChanged", [OTHER_ACCOUNT])
  provider.emit("accountsChanged", [])
  provider.emit("chainChanged", "0x1")
  assert.deepEqual(changes, [
    { type: "accountsChanged", accounts: [OTHER_ACCOUNT] },
    { type: "accountsChanged", accounts: [] },
    { type: "chainChanged", chainId: "0x1" },
  ])
  assert.deepEqual(failures, [])
  assert.deepEqual(provider.requests, [])
  unsubscribe()
})

test("malformed wallet events fail at the injected provider boundary", () => {
  const provider = eventProvider()
  const changes: unknown[] = []
  const failures: unknown[] = []
  const unsubscribe = subscribeInjectedWallet(change => changes.push(change), error => failures.push(error))

  for (const accounts of [null, "account", [ACCOUNT, "bad address"], [7]]) provider.emit("accountsChanged", accounts)
  for (const chain of [1, null, "eip155:1", "0x", "0xno"]) provider.emit("chainChanged", chain)
  assert.deepEqual(changes, [])
  assert.equal(failures.length, 9)
  assert(failures.every(error => error instanceof Error))
  unsubscribe()
})

test("wallet cleanup removes exact listeners from the subscribed provider and ignores queued events", () => {
  const first = eventProvider()
  const changes: unknown[] = []
  const unsubscribe = subscribeInjectedWallet(change => changes.push(change), error => { throw error })
  const queuedAccountListener = first.listeners.get("accountsChanged")
  assert(queuedAccountListener)
  const second = eventProvider()

  unsubscribe()
  unsubscribe()
  queuedAccountListener([OTHER_ACCOUNT])
  first.emit("chainChanged", "0x1")
  assert.deepEqual(changes, [])
  assert.equal(first.listeners.size, 0)
  assert.equal(first.removals.length, 3)
  assert.deepEqual(second.removals, [])
})

test("request-only wallets remain usable without event support", () => {
  withEthereumAccounts([ACCOUNT])
  const unsubscribe = subscribeInjectedWallet(() => assert.fail("unexpected event"), () => assert.fail("unexpected failure"))
  unsubscribe()
})

test("wallet account check accepts the selected connected account", async () => {
  withEthereumAccounts([ACCOUNT])

  await ensureConnectedWalletAccount(ACCOUNT)
})

test("wallet account check rejects stale connected account state", async () => {
  withEthereumAccounts([OTHER_ACCOUNT])

  await assert.rejects(
    ensureConnectedWalletAccount(ACCOUNT),
    /Connected wallet account changed/,
  )
})

test("wallet chain helper validates RPC URLs at the wallet boundary", () => {
  assert.deepEqual(walletChain({
    chainId: "eip155:31337",
    rpcUrl: "http://127.0.0.1:8545/rpc",
  }).rpcUrls.default.http, ["http://127.0.0.1:8545/rpc"])

  assert.throws(
    () => walletChain({
      chainId: "eip155:31337",
      rpcUrl: "javascript:alert(1)",
    }),
    /rpcUrl: expected http or https URL/,
  )
})

test("wallet chain setup switches again after adding an unknown chain", async () => {
  const methods: string[] = []
  let switchAttempts = 0
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      ethereum: {
        async request({ method }: { readonly method: string }): Promise<unknown> {
          methods.push(method)
          if (method === "wallet_switchEthereumChain") {
            switchAttempts += 1
            if (switchAttempts === 1) {
              const error = new Error("unknown chain") as Error & { code: number }
              error.code = 4902
              throw error
            }
            return null
          }
          if (method === "wallet_addEthereumChain") return null
          if (method === "eth_chainId") return "0x7a69"
          throw new Error(`unexpected wallet method: ${method}`)
        },
      },
    },
  })

  await ensureInjectedWalletChain(CHAIN_OPTIONS)

  assert.deepEqual(methods, [
    "wallet_switchEthereumChain",
    "wallet_addEthereumChain",
    "wallet_switchEthereumChain",
    "eth_chainId",
  ])
})

test("wallet chain setup rejects a wallet that remains on the wrong chain", async () => {
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      ethereum: {
        async request({ method }: { readonly method: string }): Promise<unknown> {
          if (method === "wallet_switchEthereumChain") return null
          if (method === "eth_chainId") return "0x1"
          throw new Error(`unexpected wallet method: ${method}`)
        },
      },
    },
  })

  await assert.rejects(
    ensureInjectedWalletChain(CHAIN_OPTIONS),
    /Injected wallet chain mismatch/,
  )
})

test("wallet chain setup preserves switch failures with hostile error codes", async () => {
  const switchError = Object.defineProperty(new Error("switch denied"), "code", {
    get() {
      throw new Error("code getter failed")
    },
  })
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      ethereum: {
        async request({ method }: { readonly method: string }): Promise<unknown> {
          if (method === "wallet_switchEthereumChain") throw switchError
          throw new Error(`unexpected wallet method: ${method}`)
        },
      },
    },
  })

  await assert.rejects(
    ensureInjectedWalletChain(CHAIN_OPTIONS),
    /switch denied/,
  )
})

function withEthereumAccounts(accounts: readonly string[]): void {
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      ethereum: {
        async request({ method }: { readonly method: string }): Promise<unknown> {
          assert.equal(method, "eth_accounts")
          return accounts
        },
      },
    },
  })
}

function eventProvider() {
  const listeners = new Map<string, (value: unknown) => void>()
  const removals: string[] = []
  const requests: string[] = []
  const provider = {
    listeners,
    removals,
    requests,
    async request({ method }: { readonly method: string }): Promise<unknown> {
      requests.push(method)
      throw new Error(`unexpected wallet request: ${method}`)
    },
    on(event: string, listener: (value: unknown) => void) { listeners.set(event, listener) },
    removeListener(event: string, listener: (value: unknown) => void) {
      assert.equal(listeners.get(event), listener)
      listeners.delete(event)
      removals.push(event)
    },
    emit(event: string, value: unknown) { listeners.get(event)?.(value) },
  }
  Object.defineProperty(globalThis, "window", { configurable: true, value: { ethereum: provider } })
  return provider
}

test("wallet subscription does not misclassify consumer failures as malformed account events", () => {
  const provider = eventProvider()
  const consumerFailure = new Error("consumer failed")
  const failures: unknown[] = []
  const unsubscribe = subscribeInjectedWallet(() => { throw consumerFailure }, error => failures.push(error))
  assert.throws(() => provider.emit("accountsChanged", [ACCOUNT]), error => error === consumerFailure)
  assert.deepEqual(failures, [])
  unsubscribe()
})

test("partial wallet listener registration failure removes the already registered listener", () => {
  const provider = eventProvider()
  const on = provider.on
  provider.on = (event, listener) => {
    if (event === "chainChanged") throw new Error("event registration failed")
    on(event, listener)
  }
  assert.throws(() => subscribeInjectedWallet(() => {}, () => {}), /event registration failed/)
  assert.equal(provider.listeners.size, 0)
  assert.deepEqual(provider.removals, ["accountsChanged"])
})
