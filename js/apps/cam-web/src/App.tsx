import {
  useEffect,
  useRef,
  useState,
} from "react"
import type { ReactElement } from "react"

import {
  sendCamContractCall,
  simulateCamContractCall,
} from "@cam/evm-viem"
import type {
  ResolvedButtonNode,
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
  ensureConnectedWalletAccount,
  ensureInjectedWalletChain,
  initialWalletState,
  walletChain,
  walletLabel,
} from "./wallet.ts"
import type { WalletState } from "./wallet.ts"
import { errorMessage } from "./errors.ts"
import {
  assertHostHasCode,
  assertRpcChain,
  createPinnedOriginResourceLoader,
  displayRpcEndpoint,
  parseStartupOptions,
  readStartupPolicy,
} from "./startup.ts"
import type { StartupOptions } from "./startup.ts"
import {
  ConnectionSummary,
  PreparedCallView,
  UiView,
} from "./components.tsx"
import {
  type PreparedCallSubmitterPorts,
  submittedTransactionDiagnosis,
  submitPreparedContractCall,
  waitForSubmittedTransactionReceipt,
} from "./transactions.ts"

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

const RECEIPT_WAIT_TIMEOUT_MS = 20_000
const RECEIPT_POLLING_INTERVAL_MS = 500
const PREPARED_CALL_SUBMITTER_PORTS: PreparedCallSubmitterPorts<
  ReturnType<typeof createInjectedWalletClient>,
  ReturnType<typeof walletChain>
> = {
  ensureAccount: ensureConnectedWalletAccount,
  simulate: simulateCamContractCall,
  ensureChain: ensureInjectedWalletChain,
  createWalletClient: createInjectedWalletClient,
  chain: walletChain,
  send: async ({ walletClient, chain, call }) => await sendCamContractCall({ walletClient, chain, call }),
}

export function App(): ReactElement {
  const [loadState, setLoadState] = useState<LoadState>({ status: "loading" })
  const [wallet, setWallet] = useState<WalletState>(() => initialWalletState())
  const [notice, setNotice] = useState<string | undefined>(undefined)
  const [preparedCall, setPreparedCall] = useState<CamViewerPreparedContractCall | undefined>(undefined)
  const [sending, setSending] = useState(false)
  const interactionRevision = useRef(0)
  const sendRevision = useRef(0)
  const sendingRef = useRef(false)

  useEffect(() => {
    let cancelled = false

    async function load(): Promise<void> {
      try {
        const startup = parseStartupOptions(new URL(window.location.href), readStartupPolicy(import.meta.env))
        const publicClient = createPublicClient({
          transport: http(startup.rpcUrl),
        })
        await assertRpcChain(publicClient, startup.chainId)
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
          inputs: {},
          allowUnsignedCamHash: startup.allowUnsignedCamHash,
          loadResource: createPinnedOriginResourceLoader(startup.resourceOrigin),
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

  async function dispatch(action: ResolvedButtonNode): Promise<void> {
    const ready = requireReadyState(loadState)
    const revision = nextInteractionRevision()
    setNotice(undefined)
    setPreparedCall(undefined)

    try {
      const result = await ready.runtime.session.dispatchAction(action)
      if (!isCurrentInteraction(revision)) return
      if (result.type === "navigated") {
        setLoadState({ ...ready, snapshot: result.snapshot })
        return
      }

      await preflightPreparedCall(result.call)
      if (!isCurrentInteraction(revision)) return
      setPreparedCall(result.call)
      setNotice(wallet.status === "connected"
        ? "Prepared contract call. Simulation passed; review it before sending."
        : "Prepared contract call. Simulation passed; connect a wallet to send it.")
    } catch (error) {
      if (!isCurrentInteraction(revision)) return
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
      invalidatePreparedInteraction()
      const startup = ready.runtime.startup
      const address = await connectInjectedWallet(startup)
      const snapshot = await ready.runtime.session.setAccount({ address })

      setWallet({ status: "connected", address })
      setLoadState({ ...ready, snapshot })
      setNotice(address.toLowerCase() === startup.account.toLowerCase()
        ? "Wallet connected."
        : "Wallet connected. It differs from the initial account URL parameter.")
    } catch (error) {
      setNotice(errorMessage(error))
    }
  }

  async function sendPreparedCall(call: CamViewerPreparedContractCall): Promise<void> {
    if (sendingRef.current) {
      setNotice("A wallet submission is already in progress.")
      return
    }
    if (wallet.status !== "connected") {
      setNotice("Connect a wallet before sending.")
      return
    }

    const interaction = interactionRevision.current
    const send = nextSendRevision()
    // Before wallet submission, stale interactions may abort silently. After a
    // tx hash exists, the send revision owns user-visible transaction feedback.
    const ownsInteraction = () => isCurrentInteraction(interaction)
    const ownsSend = () => isCurrentSend(send)
    let submittedTxHash: `0x${string}` | undefined

    // React disables the button after state commit, but a second click can
    // enter this handler before that render. The ref is the synchronous
    // transaction-submission gate.
    sendingRef.current = true
    setSending(true)
    setNotice(undefined)
    try {
      const ready = requireReadyState(loadState)
      const txHash = await submitPreparedContractCall({
        ports: PREPARED_CALL_SUBMITTER_PORTS,
        publicClient: ready.runtime.publicClient,
        walletAddress: wallet.address,
        startup: ready.runtime.startup,
        call,
        shouldContinue: () => ownsInteraction() && ownsSend(),
      })
      if (txHash === undefined) return
      submittedTxHash = txHash
      if (!ownsSend()) return
      setNotice(`Transaction sent: ${txHash}`)

      const nonceGap = await submittedTransactionDiagnosis({
        client: ready.runtime.publicClient,
        txHash,
        rpcEndpoint: displayRpcEndpoint(ready.runtime.startup.rpcUrl),
        includePendingAdvice: false,
      })
      if (!ownsSend()) return
      if (nonceGap !== undefined) {
        throw new Error(nonceGap)
      }

      const receipt = await waitForReceipt(ready, txHash)
      if (!ownsSend()) return
      if (receipt.status !== "success") {
        throw new Error(`Transaction reverted: ${txHash}`)
      }
      setNotice(`Transaction confirmed in block ${receipt.blockNumber.toString()}.`)
      if (ownsInteraction()) {
        setPreparedCall(undefined)
      }

      if (call.then.namespace === "routes" && ownsInteraction()) {
        const snapshot = await ready.runtime.session.navigate(call.then.function, call.then.args)
        if (!ownsInteraction() || !ownsSend()) return
        setLoadState({ ...ready, snapshot })
      }
    } catch (error) {
      if (!ownsSend() || (submittedTxHash === undefined && !ownsInteraction())) return
      if (submittedTxHash !== undefined) {
        const message = errorMessage(error)
        if (ownsInteraction()) {
          setPreparedCall(undefined)
        }
        setNotice(message.includes(submittedTxHash) ? message : `${message} Transaction hash: ${submittedTxHash}.`)
      } else {
        setNotice(errorMessage(error))
      }
    } finally {
      sendingRef.current = false
      if (ownsSend()) {
        setSending(false)
      }
    }
  }

  function updateInput(name: string, value: string): void {
    const ready = requireReadyState(loadState)
    try {
      invalidatePreparedInteraction()
      setLoadState({
        ...ready,
        snapshot: ready.runtime.session.updateState({ [name]: value }),
      })
    } catch (error) {
      setNotice(errorMessage(error))
    }
  }

  function nextInteractionRevision(): number {
    interactionRevision.current += 1
    return interactionRevision.current
  }

  function isCurrentInteraction(revision: number): boolean {
    return interactionRevision.current === revision
  }

  function invalidatePreparedInteraction(): void {
    // Async route dispatch may still be resolving. Bump the revision whenever
    // viewer state can change so stale results cannot resurrect old prepared calls.
    interactionRevision.current += 1
    setPreparedCall(undefined)
  }

  function nextSendRevision(): number {
    sendRevision.current += 1
    return sendRevision.current
  }

  function isCurrentSend(revision: number): boolean {
    return sendRevision.current === revision
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">CAM viewer</p>
          <h1>{headerTitle(loadState)}</h1>
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
        <UiView
          snapshot={loadState.snapshot}
          onAction={dispatch}
          onInput={updateInput}
        />
      ) : null}
    </main>
  )
}

async function waitForReceipt(
  ready: Extract<LoadState, { readonly status: "ready" }>,
  txHash: `0x${string}`,
): ReturnType<AppPublicClient["waitForTransactionReceipt"]> {
  return await waitForSubmittedTransactionReceipt({
    client: ready.runtime.publicClient,
    txHash,
    rpcEndpoint: displayRpcEndpoint(ready.runtime.startup.rpcUrl),
    pollingIntervalMs: RECEIPT_POLLING_INTERVAL_MS,
    timeoutMs: RECEIPT_WAIT_TIMEOUT_MS,
  })
}

function headerTitle(loadState: LoadState): string {
  if (loadState.status !== "ready") {
    return "Loading"
  }

  const title = loadState.snapshot.resolvedUi.props.title
  if (typeof title !== "string") {
    throw new Error("resolved root UI title must be a string")
  }

  return title
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
