import assert from "node:assert/strict"
import test from "node:test"
import { createInjectedWalletBinding } from "../src/wallet-binding.ts"
import type { Address } from "viem"

const FIRST = "0x0000000000000000000000000000000000000001" as Address
const SECOND = "0x0000000000000000000000000000000000000002" as Address
const THIRD = "0x0000000000000000000000000000000000000003" as Address

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
async function settle() { for (let i = 0; i < 12; i++) await Promise.resolve() }
function fixture() {
  const listeners = new Map<string, (value: unknown) => void>()
  Object.defineProperty(globalThis, "window", { configurable: true, value: { ethereum: {
    request: async () => { throw new Error("unsolicited wallet request") },
    on: (name: string, listener: (value: unknown) => void) => listeners.set(name, listener),
    removeListener: (name: string) => listeners.delete(name),
  } } })
  const connection = deferred<Address>()
  const refreshes: { address: Address; result: ReturnType<typeof deferred<string>> }[] = []
  const commits: string[] = []
  const states: unknown[] = []
  const failures: unknown[] = []
  let invalidations = 0
  let busy = false
  const binding = createInjectedWalletBinding({
    chainId: "eip155:31337",
    connect: () => connection.promise,
    isViewBusy: () => busy,
    setAccount: async (address: Address) => {
      const result = deferred<string>()
      refreshes.push({ address, result })
      return result.promise
    },
    commitAccount: (snapshot: string) => commits.push(snapshot),
    invalidate: () => { invalidations++ },
    onState: state => states.push(state),
    onError: error => failures.push(error),
  })
  return { binding, listeners, connection, refreshes, commits, states, failures,
    invalidations: () => invalidations,
    setBusy: (value: boolean) => { busy = value },
    emit: (name: string, value: unknown) => listeners.get(name)?.(value),
  }
}

test("events are bound only by an explicit connection and late connect cannot overwrite a newer account", async () => {
  const f = fixture()
  assert.equal(f.listeners.size, 0)
  const connect = f.binding.connect()
  f.emit("accountsChanged", [SECOND])
  f.connection.resolve(FIRST)
  await settle()
  assert.deepEqual(f.refreshes.map(value => value.address), [SECOND])
  f.refreshes[0]!.result.resolve("second account view")
  await connect
  await settle()
  assert.deepEqual(f.commits, ["second account view"])
  assert.deepEqual(f.states.at(-1), { wallet: { status: "connected", address: SECOND }, chainMatches: true, refreshing: false, accountSynchronized: true })
  f.binding.dispose()
})

test("rapid account changes serialize truthful intermediate views and finish on the latest account", async () => {
  const f = fixture()
  const connect = f.binding.connect()
  f.connection.resolve(FIRST)
  await settle()
  f.emit("accountsChanged", [SECOND])
  f.emit("accountsChanged", [THIRD])
  assert.equal(f.refreshes.length, 1)
  assert(f.invalidations() >= 3)
  f.refreshes[0]!.result.resolve("obsolete first account view")
  await settle()
  assert.deepEqual(f.commits, ["obsolete first account view"])
  assert.deepEqual(f.refreshes.map(value => value.address), [FIRST, THIRD])
  f.refreshes[1]!.result.resolve("third account view")
  await connect
  await settle()
  assert.deepEqual(f.commits, ["obsolete first account view", "third account view"])
  f.binding.dispose()
})

test("disconnect retains viewed account and network changes never switch the fixed viewer chain", async () => {
  const f = fixture()
  const connect = f.binding.connect()
  f.connection.resolve(FIRST)
  await settle()
  f.refreshes[0]!.result.resolve("first account view")
  await connect
  f.emit("chainChanged", "0x1")
  assert.deepEqual(f.states.at(-1), { wallet: { status: "connected", address: FIRST }, chainMatches: false, refreshing: false, accountSynchronized: true })
  f.emit("accountsChanged", [])
  assert.deepEqual(f.states.at(-1), { wallet: { status: "disconnected" }, chainMatches: false, refreshing: false, accountSynchronized: true })
  assert.deepEqual(f.commits, ["first account view"])
  assert.equal(f.refreshes.length, 1)
  f.emit("chainChanged", "0x7a69")
  assert.deepEqual(f.states.at(-1), { wallet: { status: "disconnected" }, chainMatches: true, refreshing: false, accountSynchronized: true })
  f.binding.dispose()
})

test("account refresh failure retains committed view but removes signer capability", async () => {
  const f = fixture()
  const connect = f.binding.connect()
  f.connection.resolve(FIRST)
  await settle()
  f.refreshes[0]!.result.reject(new Error("account read failed"))
  await connect
  assert.deepEqual(f.commits, [])
  assert.equal(f.failures.length, 1)
  assert.deepEqual(f.states.at(-1), { wallet: { status: "disconnected" }, chainMatches: true, refreshing: false, accountSynchronized: false })
  f.binding.dispose()
})

test("disposal removes listeners and prevents late connection and refresh commits", async () => {
  for (const phase of ["connect", "refresh"]) {
    const f = fixture()
    const connect = f.binding.connect()
    if (phase === "refresh") { f.connection.resolve(FIRST); await settle() }
    const queued = f.listeners.get("accountsChanged")!
    f.binding.dispose()
    assert.equal(f.listeners.size, 0)
    queued([SECOND])
    f.connection.resolve(FIRST)
    f.refreshes[0]?.result.resolve("late view")
    await connect
    await settle()
    assert.deepEqual(f.commits, [])
    assert.equal(f.refreshes.length, phase === "refresh" ? 1 : 0)
  }
})

test("account events wait behind the existing view operation and resume with the latest account", async () => {
  const f = fixture()
  f.setBusy(true)
  const connect = f.binding.connect()
  f.emit("accountsChanged", [SECOND])
  f.emit("accountsChanged", [THIRD])
  f.connection.resolve(FIRST)
  await connect
  assert.equal(f.refreshes.length, 0)
  assert(f.invalidations() >= 3)
  f.setBusy(false)
  const resumed = f.binding.resume()
  await settle()
  assert.deepEqual(f.refreshes.map(value => value.address), [THIRD])
  f.refreshes[0]!.result.resolve("third account view")
  await resumed
  assert.deepEqual(f.commits, ["third account view"])
  f.binding.dispose()
})

test("disconnect during a read retains its truthful successful view without restoring another account", async () => {
  const f = fixture()
  const connect = f.binding.connect()
  f.connection.resolve(FIRST)
  await settle()
  f.emit("accountsChanged", [])
  f.refreshes[0]!.result.resolve("first account view")
  await connect
  assert.deepEqual(f.commits, ["first account view"])
  assert.equal(f.refreshes.length, 1)
  assert.deepEqual(f.states.at(-1), { wallet: { status: "disconnected" }, chainMatches: true, refreshing: false, accountSynchronized: true })
  f.binding.dispose()
})

test("a failed newest account read keeps the successful intermediate view and blocks signing", async () => {
  const f = fixture()
  const connect = f.binding.connect()
  f.connection.resolve(FIRST)
  await settle()
  f.emit("accountsChanged", [SECOND])
  f.refreshes[0]!.result.resolve("first account view")
  await settle()
  f.refreshes[1]!.result.reject(new Error("second account denied"))
  await connect
  assert.deepEqual(f.commits, ["first account view"])
  assert.equal(f.refreshes.length, 2)
  assert.deepEqual(f.states.at(-1), { wallet: { status: "disconnected" }, chainMatches: true, refreshing: false, accountSynchronized: false })
  f.binding.dispose()
})

test("provider transport disconnect revokes signing while retaining the last successful view", async () => {
  const f = fixture()
  const connect = f.binding.connect()
  f.connection.resolve(FIRST)
  await settle()
  f.refreshes[0]!.result.resolve("first account view")
  await connect
  const before = f.invalidations()
  f.emit("disconnect", { code: 4900, message: "provider disconnected" })
  assert.equal(f.invalidations(), before + 1)
  assert.deepEqual(f.commits, ["first account view"])
  assert.deepEqual(f.states.at(-1), { wallet: { status: "disconnected" }, chainMatches: true, refreshing: false, accountSynchronized: true })
  f.binding.dispose()
})

test("explicit reconnect clears an older chain mismatch but preserves a newer network event", async () => {
  for (const newerMismatch of [false, true]) {
    const f = fixture()
    const firstConnect = f.binding.connect()
    f.connection.resolve(FIRST)
    await settle()
    f.refreshes[0]!.result.resolve("first view")
    await firstConnect
    f.emit("chainChanged", "0x1")
    const reconnect = f.binding.connect()
    if (newerMismatch) f.emit("chainChanged", "0x2")
    await settle()
    f.refreshes[1]!.result.resolve("reconnected view")
    await reconnect
    assert.deepEqual(f.states.at(-1), {
      wallet: { status: "connected", address: FIRST }, chainMatches: !newerMismatch,
      refreshing: false, accountSynchronized: true,
    })
    f.binding.dispose()
  }
})

test("successful reconnect verifies network even when an exposed-account event supersedes its account reply", async () => {
  const f = fixture()
  const firstConnect = f.binding.connect()
  f.connection.resolve(FIRST)
  await settle()
  f.refreshes[0]!.result.resolve("first view")
  await firstConnect
  f.emit("chainChanged", "0x1")
  const reconnect = f.binding.connect()
  f.emit("accountsChanged", [SECOND])
  await settle()
  f.refreshes[1]!.result.resolve("second view")
  await reconnect
  await settle()
  assert.deepEqual(f.states.at(-1), {
    wallet: { status: "connected", address: SECOND }, chainMatches: true,
    refreshing: false, accountSynchronized: true,
  })
  f.binding.dispose()
})
