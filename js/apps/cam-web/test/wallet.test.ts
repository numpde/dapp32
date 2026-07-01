import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { fileURLToPath } from "node:url"

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

test("send path revalidates account after wallet chain switching", () => {
  const appSource = readFileSync(fileURLToPath(new URL("../src/App.tsx", import.meta.url)), "utf8")
  const chainSwitch = appSource.indexOf("await ensureInjectedWalletChain(ready.runtime.startup)")
  const clientCreation = appSource.indexOf("const walletClient = createInjectedWalletClient(wallet.address)")
  const accountCheck = appSource.indexOf("await ensureConnectedWalletAccount(wallet.address)", chainSwitch)

  assert.notEqual(chainSwitch, -1)
  assert.notEqual(clientCreation, -1)
  assert.ok(
    accountCheck > chainSwitch && accountCheck < clientCreation,
    "wallet account must be revalidated after chain switching and before wallet client creation",
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
