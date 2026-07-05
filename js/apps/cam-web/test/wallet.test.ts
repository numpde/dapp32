import assert from "node:assert/strict"
import test from "node:test"

import { ensureConnectedWalletAccount, ensureInjectedWalletChain } from "../src/wallet.ts"

const ACCOUNT = "0x0000000000000000000000000000000000000001"
const OTHER_ACCOUNT = "0x0000000000000000000000000000000000000002"
const CHAIN_OPTIONS = {
  chainId: "eip155:31337",
  rpcUrl: "http://127.0.0.1:8545",
}

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
