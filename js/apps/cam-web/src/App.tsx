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
import { createInjectedWalletBinding } from "./wallet-binding.ts"
import { actionFailure, failureReport, UserFacingError } from "./errors.ts"
import type { FailureReport } from "./errors.ts"
import { Feedback } from "./feedback.tsx"
import { IntegrityWarnings } from "./integrity-warnings.tsx"
import { calculateDocumentHashFromFile, calculateDocumentHashFromURL } from "./document-hash.ts"
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
  | { readonly status: "failed"; readonly failure: FailureReport }

type AppPublicClient = ReturnType<typeof createPublicClient>

type AppRuntime = {
  readonly startup: StartupOptions
  readonly publicClient: AppPublicClient
  readonly session: CamViewerSession
}

type Notice = FailureReport & { readonly kind: "error" | "status" }
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
  const [walletChainMatches, setWalletChainMatches] = useState(true)
  const [walletRefreshing, setWalletRefreshing] = useState(false)
  const [walletAccountSynchronized, setWalletAccountSynchronized] = useState(true)
  const [notice, setNotice] = useState<Notice | undefined>(undefined)
  const [transactionNotice, setTransactionNotice] = useState<Notice | undefined>(undefined)
  const [preparedCall, setPreparedCallState] = useState<CamViewerPreparedContractCall | undefined>(undefined)
  const preparedCallRef = useRef<CamViewerPreparedContractCall | undefined>(undefined)
  const [sending, setSending] = useState(false)
  const [changingView, setChangingView] = useState(false)
  const interactionRevision = useRef(0)
  const sendRevision = useRef(0)
  const sendingRef = useRef(false)
  const changingViewRef = useRef(false)
  const walletRefreshingRef = useRef(false)
  const walletAccountSynchronizedRef = useRef(true)
  const walletBindingRef = useRef<{ connect(): Promise<void>; resume(): Promise<void>; dispose(): void } | undefined>(undefined)
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
    let loadedSession: CamViewerSession | undefined

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
          loadResource: createPinnedOriginResourceLoader(startup.resourceOrigin),
        })
        const snapshot = await session.load()
        loadedSession = session

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
            failure: failureReport(error, "The app could not be loaded. Check the connection settings and technical details below."),
          })
        }
      }
    }

    void load()

    return () => {
      cancelled = true
      if (loadedSession !== undefined) {
        const documentHashes = loadedSession.snapshot().documentHashes
        if (documentHashes !== undefined) {
          for (const name of Object.keys(documentHashes)) loadedSession.cancelDocumentHash(name)
        }
      }
    }
  }, [])

  const loadedRuntime = loadState.status === "ready" ? loadState.runtime : undefined
  useEffect(() => {
    if (loadedRuntime === undefined) return
    const ready = requireReadyState(loadState)
    const binding = createInjectedWalletBinding({
      chainId: loadedRuntime.startup.chainId,
      connect: () => connectInjectedWallet(loadedRuntime.startup),
      isViewBusy: () => changingViewRef.current,
      setAccount: async address => {
        setViewChanging(true)
        try { return await loadedRuntime.session.setAccount({ address }) }
        finally { setViewChanging(false) }
      },
      commitAccount: snapshot => commitSnapshot(ready, snapshot),
      invalidate: invalidatePreparedInteraction,
      onState: state => {
        walletRefreshingRef.current = state.refreshing
        walletAccountSynchronizedRef.current = state.accountSynchronized
        setWallet(state.wallet)
        setWalletRefreshing(state.refreshing)
        setWalletAccountSynchronized(state.accountSynchronized)
        setWalletChainMatches(state.chainMatches)
        if (!state.chainMatches) {
          showError({ message: `Wallet network differs from viewer chain ${loadedRuntime.startup.chainId}. Change the network in your wallet, then use Reconnect wallet. The app stays on its configured network.` }, false)
        } else if (!state.refreshing && state.accountSynchronized) {
          showStatus(state.wallet.status === "connected" ? "Wallet connected." : "Wallet disconnected. The selected account is unchanged.", false)
        }
      },
      onError: error => showError(failureReport(error, "Cannot synchronize the wallet account. The selected account is unchanged. Use Reconnect wallet to retry."), false),
    })
    walletBindingRef.current = binding
    return () => {
      binding.dispose()
      if (walletBindingRef.current === binding) walletBindingRef.current = undefined
    }
  }, [loadedRuntime])

  useEffect(() => {
    async function navigateFromFragment(): Promise<void> {
      if (loadState.status !== "ready") {
        // Startup owns the URL until the first view loads. A changed startup
        // request is handled by the same tab, rather than overwriting it later.
        window.location.reload()
        return
      }
      if (sendingRef.current || viewInteractionBlocked()) {
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
        commitSnapshot(ready, snapshot)
        if (!isCurrentInteraction(revision)) return
        arriveAtFeedback("view")
      } catch (error) {
        window.history.replaceState(window.history.state, "", committedUrlRef.current)
        if (!isCurrentInteraction(revision)) return
        showError(failureReport(error, "Cannot open the requested view. The previous view is kept."), true)
      } finally {
        setViewChanging(false)
      }
    }
    const onHashChange = () => { void navigateFromFragment() }
    window.addEventListener("hashchange", onHashChange)
    return () => window.removeEventListener("hashchange", onHashChange)
  }, [loadState])

  async function dispatch(action: ResolvedButtonNode): Promise<void> {
    if (sendingRef.current || viewInteractionBlocked()) return
    const ready = requireReadyState(loadState)
    const revision = nextInteractionRevision()
    setNotice(undefined)
    setPreparedCall(undefined)

    try {
      setViewChanging(true)
      let result
      try {
        result = await ready.runtime.session.dispatchAction(action)
        if (result.type === "navigated") commitSnapshot(ready, result.snapshot)
      } finally {
        setViewChanging(false)
      }
      if (!isCurrentInteraction(revision)) return
      if (result.type === "navigated") {
        arriveAtFeedback("view")
        return
      }

      await preflightPreparedCall(result.call)
      if (!isCurrentInteraction(revision)) return
      setPreparedCall(result.call)
      showStatus(!walletChainMatches
        ? `Simulation passed on viewer chain ${ready.runtime.startup.chainId}, but the wallet is on another network. Change the network in your wallet, use Reconnect wallet, then review the transaction again.`
        : wallet.status === "connected"
          ? "Simulation passed. Review the transaction, then send it with your wallet."
          : "Simulation passed. Connect a wallet, then review the transaction again before sending.", false)
      arriveAtFeedback("prepared")
    } catch (error) {
      if (!isCurrentInteraction(revision)) return
      showError(actionFailure(error, action.props.label), true)
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
    if (sendingRef.current || changingViewRef.current || walletRefreshingRef.current) return
    await walletBindingRef.current?.connect()
  }

  async function goBack(): Promise<void> {
    if (sendingRef.current || viewInteractionBlocked()) return
    const ready = requireReadyState(loadState)
    const revision = nextInteractionRevision()
    setPreparedCall(undefined)
    setNotice(undefined)
    setViewChanging(true)
    try {
      const snapshot = await ready.runtime.session.back()
      commitSnapshot(ready, snapshot)
      if (!isCurrentInteraction(revision)) return
      arriveAtFeedback("view")
    } catch (error) {
      if (isCurrentInteraction(revision)) showError(failureReport(error, "Cannot open the previous view."), true)
    } finally {
      setViewChanging(false)
    }
  }

  async function refreshView(): Promise<void> {
    if (sendingRef.current || viewInteractionBlocked()) return
    const ready = requireReadyState(loadState)
    const revision = nextInteractionRevision()
    setPreparedCall(undefined)
    setNotice(undefined)
    setViewChanging(true)
    try {
      const snapshot = await ready.runtime.session.refresh()
      commitSnapshot(ready, snapshot)
      if (!isCurrentInteraction(revision)) return
      arriveAtFeedback("view")
    } catch (error) {
      if (isCurrentInteraction(revision)) showError(failureReport(error, "Cannot refresh this view. The displayed values have not been refreshed."), true)
    } finally {
      setViewChanging(false)
    }
  }

  function discardPreparedCall(): void {
    if (sendingRef.current || viewInteractionBlocked()) return
    invalidatePreparedInteraction()
    setNotice(undefined)
    arriveAtFeedback("view")
  }

  async function sendPreparedCall(call: CamViewerPreparedContractCall): Promise<void> {
    if (preparedCallRef.current !== call) return
    if (viewInteractionBlocked() || !walletChainMatches) return
    if (sendingRef.current) {
      showStatus("A wallet submission is already in progress.", false)
      return
    }
    if (wallet.status !== "connected") {
      showError({ message: "Connect a wallet before sending." }, true)
      return
    }

    const interaction = interactionRevision.current
    const send = nextSendRevision()
    // Before wallet submission, stale interactions may abort silently. After a
    // tx hash exists, the send revision owns user-visible transaction feedback.
    const ownsInteraction = () => isCurrentInteraction(interaction)
    const ownsSend = () => isCurrentSend(send)
    let submittedTxHash: `0x${string}` | undefined
    let reverted = false

    // React disables the button after state commit, but a second click can
    // enter this handler before that render. The ref is the synchronous
    // transaction-submission gate.
    sendingRef.current = true
    cancelPendingDocumentHashes()
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
      reportTransaction({ message: `Transaction submitted: ${txHash}` }, "status", false)

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
        reverted = true
        throw new Error(`Transaction reverted: ${txHash}`)
      }
      reportTransaction({ message: `Transaction confirmed in block ${receipt.blockNumber.toString()}. Transaction hash: ${txHash}.` }, "status", ownsInteraction())
      if (ownsInteraction()) {
        setPreparedCall(undefined)
      }

      if (call.then.namespace === "routes" && ownsInteraction()) {
        try {
          setViewChanging(true)
          try {
            const snapshot = await ready.runtime.session.navigate(call.then.function, call.then.args)
            if (!ownsSend()) return
            commitSnapshot(ready, snapshot)
          } finally {
            setViewChanging(false)
          }
        } catch (error) {
          if (!ownsInteraction() || !ownsSend()) return
          showError(failureReport(error, "The transaction is confirmed, but the view could not be refreshed. Refresh the view to check its current values."), true)
        }
      }
    } catch (error) {
      if (!ownsSend() || (submittedTxHash === undefined && !(error instanceof SubmissionOutcomeUnknownError) && !ownsInteraction())) return
      if (submittedTxHash !== undefined) {
        if (ownsInteraction()) {
          setPreparedCall(undefined)
        }
        reportTransaction(failureReport(error, reverted
          ? `Transaction reverted. Transaction hash: ${submittedTxHash}.`
          : `Transaction submitted, but confirmation could not be checked. Check its status before sending another transaction. Transaction hash: ${submittedTxHash}.`), "error", ownsInteraction())
      } else if (error instanceof SubmissionOutcomeUnknownError) {
        if (ownsInteraction()) setPreparedCall(undefined)
        reportTransaction(failureReport(error.cause, "The transaction may have been sent, but the wallet did not return a transaction hash. Check your wallet before trying again."), "error", ownsInteraction())
      } else {
        showError(failureReport(error, "Transaction not sent."), true)
      }
    } finally {
      sendingRef.current = false
      if (ownsSend()) {
        setSending(false)
      }
    }
  }

  function updateInput(name: string, value: string): void {
    if (sendingRef.current || viewInteractionBlocked()) return
    const ready = requireReadyState(loadState)
    try {
      invalidatePreparedInteraction()
      setLoadState({
        ...ready,
        snapshot: ready.runtime.session.updateState({ [name]: value }),
      })
    } catch (error) {
      showError(failureReport(error, "Cannot update this field."), true)
    }
  }

  function updateAmount(name: string, representation: "base" | "display", text: string, options?: { readonly composing?: boolean }): void {
    if (sendingRef.current || viewInteractionBlocked()) return
    const ready = requireReadyState(loadState)
    try {
      invalidatePreparedInteraction()
      setLoadState({ ...ready, snapshot: ready.runtime.session.editAmount(name, representation, text, options) })
    } catch (error) {
      showError(failureReport(error, "Cannot update this amount."), true)
    }
  }

  function updateDuration(name: string, part: import("@cam/screen").DurationPart, text: string, options?: { readonly composing?: boolean }): void {
    if (sendingRef.current || viewInteractionBlocked()) return
    const ready = requireReadyState(loadState)
    try {
      invalidatePreparedInteraction()
      setLoadState({ ...ready, snapshot: ready.runtime.session.editDuration(name, part, text, options) })
    } catch (error) {
      showError(failureReport(error, "Cannot update this duration."), true)
    }
  }

  function updateInteger(name: string, text: string, options?: { readonly composing?: boolean }): void {
    if (sendingRef.current || viewInteractionBlocked()) return
    const ready = requireReadyState(loadState)
    try {
      invalidatePreparedInteraction()
      setLoadState({ ...ready, snapshot: ready.runtime.session.editInteger(name, text, options) })
    } catch (error) {
      showError(failureReport(error, "Cannot update this number."), true)
    }
  }

  function setViewChanging(value: boolean): void {
    if (value) cancelPendingDocumentHashes()
    changingViewRef.current = value
    setChangingView(value)
    if (!value) void walletBindingRef.current?.resume()
  }

  function viewInteractionBlocked(): boolean {
    return changingViewRef.current || walletRefreshingRef.current || !walletAccountSynchronizedRef.current
  }

  function cancelPendingDocumentHashes(): void {
    if (loadState.status !== "ready") return
    const session = loadState.runtime.session
    const documentHashes = session.snapshot().documentHashes
    if (documentHashes === undefined) return
    let snapshot = loadState.snapshot
    for (const [name, status] of Object.entries(documentHashes)) {
      if (status.status === "pending") snapshot = session.cancelDocumentHash(name)
    }
    if (snapshot !== loadState.snapshot) setLoadState({ ...loadState, snapshot })
  }

  async function calculateDocumentHash(name: string, source: "url" | "file", file?: File): Promise<void> {
    if (sendingRef.current || viewInteractionBlocked()) return
    const ready = requireReadyState(loadState)
    try {
      const operation = ready.runtime.session.beginDocumentHash(name, source)
      invalidatePreparedInteraction()
      setLoadState({ ...ready, snapshot: operation.snapshot })
      try {
        let digest: string
        if (source === "file") {
          digest = await calculateDocumentHashFromFile(requireDocumentFile(file), operation.signal)
        } else {
          if (operation.sourceURI === undefined) throw new Error("Cannot calculate document hash from URL: the field has no source URI.")
          digest = await calculateDocumentHashFromURL(operation.sourceURI, operation.signal)
        }
        const snapshot = operation.complete(digest)
        if (snapshot !== undefined) {
          invalidatePreparedInteraction()
          setLoadState({ ...ready, snapshot })
        }
      } catch (error) {
        const snapshot = operation.fail(failureReport(error))
        if (snapshot !== undefined) setLoadState({ ...ready, snapshot })
      }
    } catch (error) {
      showError(failureReport(error, "Cannot start the document hash calculation."), true)
    }
  }

  function cancelDocumentHash(name: string): void {
    const ready = requireReadyState(loadState)
    setLoadState({ ...ready, snapshot: ready.runtime.session.cancelDocumentHash(name) })
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
      setNotice({ ...failureReport(error, "View opened, but its URL could not be updated. Refresh will open the previous view."), kind: "status" })
    }
  }

  function arriveAtFeedback(target: FeedbackArrival["target"]): void {
    setFeedbackArrival({ target, interaction: interactionRevision.current })
  }

  function showError(report: FailureReport, focus: boolean): void {
    setNotice({ ...report, kind: "error" })
    if (focus) arriveAtFeedback("notice")
  }

  function showStatus(message: string, focus: boolean): void {
    setNotice({ message, kind: "status" })
    if (focus) arriveAtFeedback("notice")
  }

  function reportTransaction(report: FailureReport, kind: Notice["kind"], focus: boolean): void {
    setTransactionNotice({ ...report, kind })
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

  function setPreparedCall(call: CamViewerPreparedContractCall | undefined): void {
    preparedCallRef.current = call
    setPreparedCallState(call)
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
      </header>
      {loadState.status !== "ready" ? null : (
        <ConnectionSummary
          chainId={loadState.runtime.startup.chainId}
          host={loadState.runtime.startup.host}
          account={currentViewerAccount(loadState)}
          wallet={walletRefreshing ? "Updating account…" : walletLabel(wallet)}
          walletHint={wallet.status === "unavailable"
            ? "No wallet detected. You can still view the app."
            : wallet.status === "connected"
              ? "Switching wallet accounts updates Viewing as and clears the transaction review."
              : "Connecting changes Viewing as to your wallet’s active account. You’ll need to review any transaction again."}
          walletAction={wallet.status === "unavailable" ? null : (
            <button className="wallet-button" type="button" disabled={changingView || walletRefreshing || sending} onClick={() => { void connectWallet() }}>
              {wallet.status === "connected" ? "Reconnect wallet" : "Connect wallet"}
            </button>
          )}
        />
      )}

      {loadState.status === "ready" ? <IntegrityWarnings warnings={loadState.snapshot.integrityWarnings} /> : null}
      {notice === undefined ? null : (
        <Feedback report={notice} kind={notice.kind} className="notice" messageRef={noticeRef} />
      )}
      {transactionNotice === undefined ? null : (
        <section className="transaction-feedback" aria-label="Transaction outcome">
          <Feedback report={transactionNotice} kind={transactionNotice.kind} className="notice" messageRef={transactionNoticeRef} />
        </section>
      )}
      {preparedCall === undefined ? null : (
        <PreparedCallView
          call={preparedCall}
          reviewRef={preparedRef}
          canSend={wallet.status === "connected" && walletChainMatches && walletAccountSynchronized && !changingView && !walletRefreshing}
          canDiscard={!sending && !changingView && !walletRefreshing}
          sending={sending}
          onSend={sendPreparedCall}
          onDiscard={discardPreparedCall}
        />
      )}

      {loadState.status === "loading" ? (
        <section className="panel">Loading app...</section>
      ) : null}

      {loadState.status === "failed" ? (
        <section className="panel error">
          <h2>Cannot load app</h2>
          <Feedback report={loadState.failure} kind="error" />
        </section>
      ) : null}

      {loadState.status === "ready" ? (
        <UiView
          snapshot={loadState.snapshot}
          actionKind={loadState.runtime.session.actionKind}
          viewRef={viewRef}
          changingView={changingView || walletRefreshing || !walletAccountSynchronized}
          sending={sending}
          onBack={goBack}
          onRefresh={refreshView}
          onAction={dispatch}
          onInput={updateInput}
          onAmount={updateAmount}
          onInteger={updateInteger}
          onDuration={updateDuration}
          onDocumentHash={calculateDocumentHash}
          onCancelDocumentHash={cancelDocumentHash}
        />
      ) : null}
    </main>
  )
}

function requireDocumentFile(file: File | undefined): File {
  if (file === undefined) throw new UserFacingError("Choose a file to calculate its SHA-256 digest.")
  return file
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

  const root = loadState.snapshot.resolvedUi
  const title = root.element === "Screen" ? root.props.title : undefined
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
