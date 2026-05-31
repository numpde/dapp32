import {
  useEffect,
  useState,
} from "react"
import type { ReactElement } from "react"

import {
  sendCamContractCall,
  simulateCamContractCall,
} from "@cam/evm-viem"
import type {
  ResolvedScreenAction,
} from "@cam/screen"
import {
  createCamViewerSession,
} from "@cam/viewer"
import type {
  CamViewerLoadedSnapshot,
  CamViewerPreparedContractCall,
  CamViewerSession,
} from "@cam/viewer"
import {
  createPublicClient,
  http,
} from "viem"
import {
  connectInjectedWallet,
  createInjectedWalletClient,
  ensureInjectedWalletChain,
  initialWalletState,
  walletLabel,
} from "./wallet"
import type { WalletState } from "./wallet"
import { errorMessage } from "./errors"
import {
  assertHostHasCode,
  createPinnedOriginResourceLoader,
  parseStartupOptions,
} from "./startup"
import type { StartupOptions } from "./startup"
import {
  ConnectionSummary,
  PreparedCallView,
  ScreenView,
} from "./components"

type LoadState =
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly runtime: AppRuntime; readonly snapshot: CamViewerLoadedSnapshot }
  | { readonly status: "failed"; readonly message: string }

type AppPublicClient = ReturnType<typeof createPublicClient>

type AppRuntime = {
  readonly startup: StartupOptions
  readonly publicClient: AppPublicClient
  readonly session: CamViewerSession
}

export function App(): ReactElement {
  const [loadState, setLoadState] = useState<LoadState>({ status: "loading" })
  const [wallet, setWallet] = useState<WalletState>(() => initialWalletState())
  const [notice, setNotice] = useState<string | undefined>(undefined)
  const [preparedCall, setPreparedCall] = useState<CamViewerPreparedContractCall | undefined>(undefined)
  const [sending, setSending] = useState(false)

  useEffect(() => {
    let cancelled = false

    async function load(): Promise<void> {
      try {
        const startup = parseStartupOptions(new URL(window.location.href))
        const publicClient = createPublicClient({
          transport: http(startup.rpcUrl),
        })
        await assertHostHasCode(publicClient, startup.host)
        const session = createCamViewerSession({
          publicClient,
          host: {
            chainId: startup.chainId,
            address: startup.host,
          },
          account: {
            address: startup.account,
          },
          params: {},
          allowUnsignedCamHash: startup.allowUnsignedCamHash,
          loadResource: createPinnedOriginResourceLoader(),
        })
        const snapshot = await session.load()

        if (!cancelled) {
          setLoadState({
            status: "ready",
            runtime: {
              startup,
              publicClient,
              session,
            },
            snapshot,
          })
        }
      } catch (error) {
        if (!cancelled) {
          setLoadState({
            status: "failed",
            message: errorMessage(error),
          })
        }
      }
    }

    void load()

    return () => {
      cancelled = true
    }
  }, [])

  async function dispatch(action: ResolvedScreenAction): Promise<void> {
    const ready = requireReadyState(loadState)
    setNotice(undefined)
    setPreparedCall(undefined)

    try {
      const result = await ready.runtime.session.dispatchAction(action)
      if (result.type === "navigated") {
        setLoadState({ ...ready, snapshot: result.snapshot })
        return
      }

      await preflightPreparedCall(result.call)
      setPreparedCall(result.call)
      setNotice(wallet.status === "connected"
        ? "Prepared contract call. Simulation passed; review it before sending."
        : "Prepared contract call. Simulation passed; connect a wallet to send it.")
    } catch (error) {
      setNotice(errorMessage(error))
    }
  }

  async function preflightPreparedCall(call: CamViewerPreparedContractCall): Promise<void> {
    const ready = requireReadyState(loadState)
    await simulateCamContractCall({
      publicClient: ready.runtime.publicClient,
      account: wallet.status === "connected" ? wallet.address : currentViewerAccount(ready),
      call,
    })
  }

  async function connectWallet(): Promise<void> {
    try {
      const ready = requireReadyState(loadState)
      const startup = ready.runtime.startup
      const address = await connectInjectedWallet(startup)
      const snapshot = await ready.runtime.session.setAccount({ address })

      setWallet({ status: "connected", address })
      setLoadState({ ...ready, snapshot })
      setPreparedCall(undefined)
      setNotice(address.toLowerCase() === startup.account.toLowerCase()
        ? "Wallet connected."
        : "Wallet connected. It differs from the initial account URL parameter.")
    } catch (error) {
      setNotice(errorMessage(error))
    }
  }

  async function sendPreparedCall(call: CamViewerPreparedContractCall): Promise<void> {
    if (wallet.status !== "connected") {
      setNotice("Connect a wallet before sending.")
      return
    }

    setSending(true)
    setNotice(undefined)
    try {
      const ready = requireReadyState(loadState)
      await simulateCamContractCall({
        publicClient: ready.runtime.publicClient,
        account: wallet.address,
        call,
      })
      await ensureInjectedWalletChain(ready.runtime.startup)
      const walletClient = createInjectedWalletClient(wallet.address)
      const txHash = await sendCamContractCall({ walletClient, call })
      setNotice(`Transaction sent: ${txHash}`)

      const receipt = await ready.runtime.publicClient.waitForTransactionReceipt({
        hash: txHash,
      })
      if (receipt.status !== "success") {
        throw new Error(`Transaction reverted: ${txHash}`)
      }
      setNotice(`Transaction confirmed in block ${receipt.blockNumber.toString()}.`)
      setPreparedCall(undefined)

      if (call.onSuccess !== undefined) {
        const result = await ready.runtime.session.dispatchAction(call.onSuccess)
        if (result.type === "navigated") {
          setLoadState({ ...ready, snapshot: result.snapshot })
        }
      }
    } catch (error) {
      setNotice(errorMessage(error))
    } finally {
      setSending(false)
    }
  }

  function updateInput(name: string, value: string): void {
    const ready = requireReadyState(loadState)
    try {
      setPreparedCall(undefined)
      setLoadState({
        ...ready,
        snapshot: ready.runtime.session.updateForm({ [name]: value }),
      })
    } catch (error) {
      setNotice(errorMessage(error))
    }
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">CAM viewer</p>
          <h1>{loadState.status === "ready" ? loadState.snapshot.resolvedScreen?.title ?? "Untitled screen" : "Loading"}</h1>
        </div>
        {loadState.status !== "ready" ? null : (
          <ConnectionSummary
            chainId={loadState.runtime.startup.chainId}
            host={loadState.runtime.startup.host}
            account={currentViewerAccount(loadState)}
            wallet={walletLabel(wallet)}
          />
        )}
      </header>

      {wallet.status === "unavailable" ? (
        <p className="notice">No injected wallet was detected.</p>
      ) : (
        <button className="wallet-button" type="button" onClick={() => { void connectWallet() }}>
          {wallet.status === "connected" ? "Switch wallet" : "Connect wallet"}
        </button>
      )}

      {notice === undefined ? null : <p className="notice">{notice}</p>}
      {preparedCall === undefined ? null : (
        <PreparedCallView
          call={preparedCall}
          canSend={wallet.status === "connected"}
          sending={sending}
          onSend={sendPreparedCall}
        />
      )}

      {loadState.status === "loading" ? (
        <section className="panel">Loading CAM session...</section>
      ) : null}

      {loadState.status === "failed" ? (
        <section className="panel error">
          <h2>Cannot load viewer</h2>
          <p>{loadState.message}</p>
        </section>
      ) : null}

      {loadState.status === "ready" ? (
        <ScreenView
          snapshot={loadState.snapshot}
          onAction={dispatch}
          onInput={updateInput}
        />
      ) : null}
    </main>
  )
}

function requireReadyState(loadState: LoadState): Extract<LoadState, { readonly status: "ready" }> {
  if (loadState.status !== "ready") {
    throw new Error("CAM viewer session is not loaded")
  }

  return loadState
}

function currentViewerAccount(loadState: Extract<LoadState, { readonly status: "ready" }>): StartupOptions["account"] {
  return loadState.snapshot.account !== undefined
    ? loadState.snapshot.account.address
    : loadState.runtime.startup.account
}
