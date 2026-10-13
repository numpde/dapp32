import type { Address } from "viem"
import { evmChainIdHex } from "@cam/evm-viem"
import { subscribeInjectedWallet } from "./wallet.ts"
import type { InjectedWalletChange, WalletState } from "./wallet.ts"

export type WalletBindingState = {
  readonly wallet: WalletState
  readonly chainMatches: boolean
  readonly refreshing: boolean
  readonly accountSynchronized: boolean
}

export function createInjectedWalletBinding<TSnapshot>(ports: {
  readonly chainId: string
  readonly connect: () => Promise<Address>
  readonly isViewBusy: () => boolean
  readonly setAccount: (address: Address) => Promise<TSnapshot>
  readonly commitAccount: (snapshot: TSnapshot) => void
  readonly invalidate: () => void
  readonly onState: (state: WalletBindingState) => void
  readonly onError: (error: unknown) => void
}) {
  const expectedChain = BigInt(evmChainIdHex(ports.chainId))
  let active = true
  let unsubscribe: (() => void) | undefined
  let accountRevision = 0
  let chainRevision = 0
  let connecting = false
  let pending = false
  let draining: Promise<void> | undefined
  let chainMatches = true
  let failed = false
  let signer: Address | undefined
  let desiredAccount: Address | undefined

  function publish() {
    if (!active) return
    const refreshing = connecting || pending || draining !== undefined
    ports.onState({
      wallet: signer === undefined || refreshing || failed
        ? { status: "disconnected" }
        : { status: "connected", address: signer },
      chainMatches,
      refreshing,
      accountSynchronized: !refreshing && !failed,
    })
  }

  function fail(error: unknown) {
    if (!active) return
    accountRevision++
    ports.invalidate()
    signer = undefined
    failed = true
    desiredAccount = undefined
    pending = false
    ports.onError(error)
    publish()
    void resume()
  }

  function receive(change: InjectedWalletChange) {
    if (!active) return
    ports.invalidate()
    if (change.type === "chainChanged") {
      chainRevision++
      chainMatches = BigInt(change.chainId) === expectedChain
      publish()
      return
    }
    accountRevision++
    failed = false
    signer = change.type === "disconnect" ? undefined : change.accounts[0]
    desiredAccount = signer
    pending = signer !== undefined
    publish()
    void resume()
  }

  async function drain() {
    while (active && pending && !ports.isViewBusy()) {
      const address = desiredAccount
      if (address === undefined) return
      const revision = accountRevision
      pending = false
      try {
        const snapshot = await ports.setAccount(address)
        if (!active) return
        // The session owns its current view. Publish each successful serialized
        // read while newer accounts wait; actions remain blocked until drained.
        ports.commitAccount(snapshot)
      } catch (error) {
        if (!active) return
        if (revision === accountRevision) fail(error)
      }
    }
  }

  function resume(): Promise<void> {
    if (!active || !pending || ports.isViewBusy()) {
      if (draining !== undefined) return draining
      return Promise.resolve()
    }
    if (draining !== undefined) return draining
    // Schedule the drain after assigning its ownership promise, so synchronous
    // port callbacks cannot start a second reconciliation.
    draining = Promise.resolve().then(drain).finally(() => {
      draining = undefined
      publish()
      if (active && pending && !ports.isViewBusy()) void resume()
    })
    publish()
    return draining
  }

  async function connect(): Promise<void> {
    if (!active || connecting) return
    const revision = accountRevision
    const networkRevision = chainRevision
    connecting = true
    failed = false
    ports.invalidate()
    publish()
    try {
      if (unsubscribe === undefined) unsubscribe = subscribeInjectedWallet(receive, fail)
      const address = await ports.connect()
      if (!active) return
      if (networkRevision === chainRevision) chainMatches = true
      if (revision !== accountRevision) return
      signer = address
      desiredAccount = address
      pending = true
    } catch (error) {
      if (active && revision === accountRevision) fail(error)
    } finally {
      if (active) {
        connecting = false
        await resume()
        publish()
      }
    }
  }

  return {
    connect,
    resume,
    dispose() {
      if (!active) return
      active = false
      accountRevision++
      pending = false
      unsubscribe?.()
    },
  }
}
