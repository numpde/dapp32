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
  parseViewFragment,
  urlForView,
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
  SubmissionOutcomeUnknownError,
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

type Notice = { readonly message: string; readonly kind: "error" | "status" }
type FeedbackArrival = {
  readonly target: "notice" | "prepared" | "view" | "transaction"
  readonly interaction: number
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
  const [notice, setNotice] = useState<Notice | undefined>(undefined)
  const [transactionNotice, setTransactionNotice] = useState<Notice | undefined>(undefined)
  const [preparedCall, setPreparedCall] = useState<CamViewerPreparedContractCall | undefined>(undefined)
  const [sending, setSending] = useState(false)
  const [changingView, setChangingView] = useState(false)
  const interactionRevision = useRef(0)
  const sendRevision = useRef(0)
  const sendingRef = useRef(false)
  const changingViewRef = useRef(false)
  const committedUrlRef = useRef(window.location.href)
  const noticeRef = useRef<HTMLParagraphElement>(null)
  const transactionNoticeRef = useRef<HTMLParagraphElement>(null)
  const preparedRef = useRef<HTMLElement>(null)
  const viewRef = useRef<HTMLElement>(null)
  const [feedbackArrival, setFeedbackArrival] = useState<FeedbackArrival | undefined>(undefined)

  useEffect(() => {
    if (feedbackArrival === undefined || feedbackArrival.interaction !== interactionRevision.current) return
    const target = feedbackArrival.target === "notice" ? noticeRef.current
      : feedbackArrival.target === "prepared" ? preparedRef.current
      : feedbackArrival.target === "transaction" ? transactionNoticeRef.current : viewRef.current
    target?.focus()
  }, [feedbackArrival])

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
          inputs: startup.inputs,
          ...(startup.route === undefined ? {} : { route: startup.route }),
          allowUnsignedCamHash: startup.allowUnsignedCamHash,
          loadResource: createPinnedOriginResourceLoader(startup.resourceOrigin),
        })
        const snapshot = await session.load()

        if (!cancelled) {
          const ready = {
            status: "ready" as const,
            runtime: {
              startup,
              publicClient,
              session,
            },
            snapshot,
          }
          commitSnapshot(ready, snapshot)
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

  useEffect(() => {
    async function navigateFromFragment(): Promise<void> {
      if (loadState.status !== "ready") {
        // Startup owns the URL until the first view loads. A changed startup
        // request is handled by the same tab, rather than overwriting it later.
        window.location.reload()
        return
      }
      if (sendingRef.current || changingViewRef.current) {
        window.history.replaceState(window.history.state, "", committedUrlRef.current)
        showStatus("Finish the current operation before opening another view.", false)
        return
      }
      const ready = loadState
      const revision = nextInteractionRevision()
      setPreparedCall(undefined)
      setNotice(undefined)
      setViewChanging(true)
      try {
        const requested = parseViewFragment(window.location.hash)
        const snapshot = await ready.runtime.session.navigate(requested.route, requested.inputs)
        if (!isCurrentInteraction(revision)) return
        commitSnapshot(ready, snapshot)
        arriveAtFeedback("view")
      } catch (error) {
        if (!isCurrentInteraction(revision)) return
        window.history.replaceState(window.history.state, "", committedUrlRef.current)
        showError(`Cannot open the requested view: ${errorMessage(error)}`, true)
      } finally {
        setViewChanging(false)
      }
    }
    const onHashChange = () => { void navigateFromFragment() }
    window.addEventListener("hashchange", onHashChange)
    return () => window.removeEventListener("hashchange", onHashChange)
  }, [loadState])

  async function dispatch(action: ResolvedButtonNode): Promise<void> {
    if (sendingRef.current || changingViewRef.current) return
    const ready = requireReadyState(loadState)
    const revision = nextInteractionRevision()
    setNotice(undefined)
    setPreparedCall(undefined)

    try {
      setViewChanging(true)
      const result = await ready.runtime.session.dispatchAction(action).finally(() => setViewChanging(false))
      if (!isCurrentInteraction(revision)) return
      if (result.type === "navigated") {
        commitSnapshot(ready, result.snapshot)
        return
      }

      await preflightPreparedCall(result.call)
      if (!isCurrentInteraction(revision)) return
      setPreparedCall(result.call)
      showStatus(wallet.status === "connected"
        ? "Prepared contract call. Simulation passed; review it before sending."
        : "Prepared contract call. Simulation passed; connect a wallet to send it.", false)
      arriveAtFeedback("prepared")
    } catch (error) {
      if (!isCurrentInteraction(revision)) return
      showError(errorMessage(error), true)
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
    if (sendingRef.current || changingViewRef.current) return
    try {
      const ready = requireReadyState(loadState)
      invalidatePreparedInteraction()
      setViewChanging(true)
      const startup = ready.runtime.startup
      const address = await connectInjectedWallet(startup)
      const snapshot = await ready.runtime.session.setAccount({ address })

      setWallet({ status: "connected", address })
      showStatus(address.toLowerCase() === startup.account.toLowerCase()
        ? "Wallet connected."
        : "Wallet connected. It differs from the initial account URL parameter.", true)
      commitSnapshot(ready, snapshot)
    } catch (error) {
      showError(errorMessage(error), true)
    } finally {
      setViewChanging(false)
    }
  }

  async function goBack(): Promise<void> {
    if (sendingRef.current || changingViewRef.current) return
    const ready = requireReadyState(loadState)
    const revision = nextInteractionRevision()
    setPreparedCall(undefined)
    setNotice(undefined)
    setViewChanging(true)
    try {
      const snapshot = await ready.runtime.session.back()
      if (isCurrentInteraction(revision)) commitSnapshot(ready, snapshot)
    } catch (error) {
      if (isCurrentInteraction(revision)) showError(errorMessage(error), true)
    } finally {
      setViewChanging(false)
    }
  }

  function discardPreparedCall(): void {
    if (sendingRef.current || changingViewRef.current) return
    invalidatePreparedInteraction()
    setNotice(undefined)
    arriveAtFeedback("view")
  }

  async function sendPreparedCall(call: CamViewerPreparedContractCall): Promise<void> {
    if (changingViewRef.current) return
    if (sendingRef.current) {
      showStatus("A wallet submission is already in progress.", false)
      return
    }
    if (wallet.status !== "connected") {
      showError("Connect a wallet before sending.", true)
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
      reportTransaction(`Transaction sent: ${txHash}`, "status", false)

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
      reportTransaction(`Transaction confirmed in block ${receipt.blockNumber.toString()}. Transaction hash: ${txHash}.`, "status", ownsInteraction())
      if (ownsInteraction()) {
        setPreparedCall(undefined)
      }

      if (call.then.namespace === "routes" && ownsInteraction()) {
        try {
          setViewChanging(true)
          const snapshot = await ready.runtime.session.navigate(call.then.function, call.then.args)
            .finally(() => setViewChanging(false))
          if (!ownsInteraction() || !ownsSend()) return
          commitSnapshot(ready, snapshot)
        } catch (error) {
          if (!ownsInteraction() || !ownsSend()) return
          showError(`The transaction is confirmed, but the view could not be refreshed: ${errorMessage(error)}`, true)
        }
      }
    } catch (error) {
      if (!ownsSend() || (submittedTxHash === undefined && !(error instanceof SubmissionOutcomeUnknownError) && !ownsInteraction())) return
      if (submittedTxHash !== undefined) {
        const message = errorMessage(error)
        if (ownsInteraction()) {
          setPreparedCall(undefined)
        }
        reportTransaction(message.includes(submittedTxHash) ? message : `${message} Transaction hash: ${submittedTxHash}.`, "error", ownsInteraction())
      } else if (error instanceof SubmissionOutcomeUnknownError) {
        if (ownsInteraction()) setPreparedCall(undefined)
        reportTransaction(errorMessage(error), "error", ownsInteraction())
      } else {
        showError(errorMessage(error), true)
      }
    } finally {
      sendingRef.current = false
      if (ownsSend()) {
        setSending(false)
      }
    }
  }

  function updateInput(name: string, value: string): void {
    if (sendingRef.current || changingViewRef.current) return
    const ready = requireReadyState(loadState)
    try {
      invalidatePreparedInteraction()
      setLoadState({
        ...ready,
        snapshot: ready.runtime.session.updateState({ [name]: value }),
      })
    } catch (error) {
      showError(errorMessage(error), true)
    }
  }

  function updateAmount(name: string, representation: "base" | "display", text: string, options?: { readonly composing?: boolean }): void {
    if (sendingRef.current || changingViewRef.current) return
    const ready = requireReadyState(loadState)
    try {
      invalidatePreparedInteraction()
      setLoadState({ ...ready, snapshot: ready.runtime.session.editAmount(name, representation, text, options) })
    } catch (error) {
      showError(errorMessage(error), true)
    }
  }

  function setViewChanging(value: boolean): void {
    changingViewRef.current = value
    setChangingView(value)
  }

  function commitSnapshot(
    ready: Extract<LoadState, { readonly status: "ready" }>,
    snapshot: CamViewerLoadedSnapshot,
  ): void {
    setLoadState({ ...ready, snapshot })
    const currentUrl = new URL(window.location.href)
    if (snapshot.account !== undefined) currentUrl.searchParams.set("account", snapshot.account.address)
    try {
      const nextUrl = urlForView(currentUrl, snapshot)
      window.history.replaceState(window.history.state, "", nextUrl.href)
      committedUrlRef.current = nextUrl.href
    } catch (error) {
      // The read succeeded. Do not misreport it as a lookup failure merely
      // because its inputs cannot be represented by the URL boundary.
      const previousUrl = new URL(committedUrlRef.current)
      if (snapshot.account !== undefined) previousUrl.searchParams.set("account", snapshot.account.address)
      window.history.replaceState(window.history.state, "", previousUrl.href)
      committedUrlRef.current = previousUrl.href
      showStatus(`View opened, but its URL could not be updated. Refresh will open the previous view. ${errorMessage(error)}`, false)
    }
  }

  function arriveAtFeedback(target: FeedbackArrival["target"]): void {
    setFeedbackArrival({ target, interaction: interactionRevision.current })
  }

  function showError(message: string, focus: boolean): void {
    setNotice({ message, kind: "error" })
    if (focus) arriveAtFeedback("notice")
  }

  function showStatus(message: string, focus: boolean): void {
    setNotice({ message, kind: "status" })
    if (focus) arriveAtFeedback("notice")
  }

  function reportTransaction(message: string, kind: Notice["kind"], focus: boolean): void {
    setTransactionNotice({ message, kind })
    if (focus) arriveAtFeedback("transaction")
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
        <button className="wallet-button" type="button" disabled={changingView || sending} onClick={() => { void connectWallet() }}>
          {wallet.status === "connected" ? "Switch wallet" : "Connect wallet"}
        </button>
      )}

      {notice === undefined ? null : (
        <p className="notice" ref={noticeRef} tabIndex={-1} role={notice.kind === "error" ? "alert" : "status"}>
          {notice.message}
        </p>
      )}
      {transactionNotice === undefined ? null : (
        <section className="transaction-feedback" aria-label="Transaction outcome">
          <p className="notice" ref={transactionNoticeRef} tabIndex={-1} role={transactionNotice.kind === "error" ? "alert" : "status"}>
            {transactionNotice.message}
          </p>
        </section>
      )}
      {preparedCall === undefined ? null : (
        <PreparedCallView
          call={preparedCall}
          reviewRef={preparedRef}
          canSend={wallet.status === "connected" && !changingView}
          canDiscard={!sending && !changingView}
          sending={sending}
          onSend={sendPreparedCall}
          onDiscard={discardPreparedCall}
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
          viewRef={viewRef}
          changingView={changingView}
          sending={sending}
          onBack={goBack}
          onAction={dispatch}
          onInput={updateInput}
          onAmount={updateAmount}
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
  if (loadState.status === "loading") {
    return "Loading"
  }
  if (loadState.status === "failed") {
    return "CAM Viewer"
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
