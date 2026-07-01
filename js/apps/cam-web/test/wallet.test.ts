import assert from "node:assert/strict"
import test from "node:test"

import { ensureConnectedWalletAccount } from "../src/wallet.ts"

const ACCOUNT = "0x0000000000000000000000000000000000000001"
const OTHER_ACCOUNT = "0x0000000000000000000000000000000000000002"

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
