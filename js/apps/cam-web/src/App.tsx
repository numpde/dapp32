import {
  useEffect,
  useRef,
  useState,
} from "react"
import type { ReactElement } from "react"
import { defaultIpfsGateway, publicIpfsGateways } from "@cam/viewer"
import { DownloadContext } from "./download-context.ts"
import { ControlRow } from "./property-row.tsx"
import { assertDownloadAllowed, downloadScopeForPrefix } from "@cam/protocol"
import type { DownloadScope } from "@cam/protocol"

import {
  sendCamContractCall,
  simulateCamContractCall,
  checkCamResourceIntegrity,
} from "@cam/evm-viem"
import type { CamIntegrityWarning, CamIntegrityCheck } from "@cam/evm-viem"
import type {
  ResolvedButtonNode,
} from "@cam/screen"
import {
  createCamViewerSession,
  CamViewerInputError,
} from "@cam/viewer"
import type {
  CamViewerLoadedSnapshot,
  CamViewerPreparedContractCall,
  CamViewerSession,
} from "@cam/viewer"
import {
  createPublicClient,
  http,
  zeroAddress,
} from "viem"
import {
  connectInjectedWallet,
  createInjectedWalletClient,
  ensureConnectedWalletAccount,
  ensureInjectedWalletChain,
  initialWalletState,
} from "./wallet.ts"
import { createBrowserHistory } from "./browser-history.ts"
import type { BrowserVisit } from "./browser-history.ts"
import type { WalletState } from "./wallet.ts"
import { createInjectedWalletBinding } from "./wallet-binding.ts"
import { actionFailure, failureReport, UserFacingError } from "./errors.ts"
import type { FailureReport } from "./errors.ts"
import { Feedback, TransactionFeedback } from "./feedback.tsx"
import { IntegrityWarnings } from "./integrity-warnings.tsx"
import { calculateDocumentHashFromFile, calculateDocumentHashFromURL } from "./document-hash.ts"
import {
  assertHostHasCode,
  assertRpcChain,
  createViewerResourceLoader,
  displayRpcEndpoint,
  parseStartupCoordinates,
  parseViewFragment,
  urlForView,
  urlForActiveConnection,
  readStartupPolicy,
} from "./startup.ts"
import type { ConnectionOptions, StartupCoordinates, StartupOptions } from "./startup.ts"
import { RpcControls } from "./rpc-controls.tsx"
import { AppSetup } from "./app-setup.tsx"
import { createRpcConnection } from "./rpc-connection.ts"
import {
  ConnectionSummary,
  PreparedCallView,
  UiView,
} from "./components.tsx"
import {
  type PreparedCallSubmitterPorts,
  type SubmittedTransactionReference,
  type TransactionStage,
  SubmissionOutcomeUnknownError,
  submittedTransactionDiagnosis,
  submitPreparedContractCall,
  waitForSubmittedTransactionReceipt,
} from "./transactions.ts"

type LoadState =
  | { readonly status: "setup" }
  | { readonly status: "loading"; readonly startup?: ConnectionOptions; readonly integrityWarnings: CamViewerLoadedSnapshot["integrityWarnings"] }
  | { readonly status: "ready"; readonly runtime: AppRuntime; readonly snapshot: CamViewerLoadedSnapshot }
  | { readonly status: "failed"; readonly failure: FailureReport; readonly startup?: ConnectionOptions; readonly integrityWarnings: CamViewerLoadedSnapshot["integrityWarnings"] }

type AppRuntime = {
  viewingMode: "public" | "account"
  readonly startup: StartupOptions
  readonly rpc: ReturnType<typeof createRpcConnection>
  readonly session: CamViewerSession
}

type AppPublicClient = ReturnType<typeof createPublicClient>

type Notice = FailureReport & { readonly kind: "error" | "status" }
type FeedbackArrival = {
  readonly target: "notice" | "prepared" | "view" | "transaction"
  readonly interaction: number
}

const RECEIPT_WAIT_TIMEOUT_MS = 20_000
const RECEIPT_POLLING_INTERVAL_MS = 500
const PREPARED_CALL_SUBMITTER_PORTS: PreparedCallSubmitterPorts<
  ReturnType<typeof createInjectedWalletClient>,
  null
> = {
  ensureAccount: ensureConnectedWalletAccount,
  simulate: simulateCamContractCall,
  ensureChain: ensureInjectedWalletChain,
  createWalletClient: createInjectedWalletClient,
  chain: () => null,
  send: async ({ walletClient, chain, call }) => await sendCamContractCall({ walletClient, chain, call }),
}

export function App(): ReactElement {
  const [viewerLink, setViewerLink] = useState<
    { readonly coordinates: StartupCoordinates; readonly rpcURLs: readonly string[] } | { readonly failure: FailureReport; readonly rpcURLs: readonly string[] }
  >(() => {
    const url = new URL(window.location.href)
    try {
      return { coordinates: parseStartupCoordinates(url), rpcURLs: url.searchParams.getAll("rpcUrl") }
    } catch (error) { return { failure: failureReport(error), rpcURLs: url.searchParams.getAll("rpcUrl") } }
  })
  const [bootResourceSetting] = useState(import.meta.env.VITE_CAM_WEB_RESOURCE_ORIGIN)
  const bootPrefix = bootResourceSetting !== undefined && bootResourceSetting !== "" && bootResourceSetting !== "*" && bootResourceSetting !== "none" ? bootResourceSetting : undefined
  const [initialDownloadScope] = useState<DownloadScope | undefined>(() => {
    try { return readStartupPolicy({ VITE_CAM_WEB_RESOURCE_ORIGIN: bootResourceSetting }) }
    // silent-defaults: allow-default -- Invalid boot settings remain unset for repair; startup still reports their parsing failure.
    catch { return undefined }
  })
  const downloadScopeRef = useRef(initialDownloadScope)
  const [scopeDraft, setScopeDraft] = useState<{ choice: string; prefix: string }>({ choice: initialDownloadScope === undefined || initialDownloadScope.kind === "prefix" ? "boot" : initialDownloadScope.kind, prefix: "" })
  const scopeDraftRef = useRef(scopeDraft)
  const [scopeError, setScopeError] = useState<FailureReport | undefined>(undefined)
  useEffect(() => {
    if (scopeDraft.choice !== "custom") return
    const timer = setTimeout(() => {
      if (scopeDraftRef.current !== scopeDraft) return
      try { commitDownloadScope(downloadScopeForPrefix(scopeDraft.prefix)) }
      catch (cause) { setScopeError(failureReport(cause, "Enter a complete URL prefix.")) }
    }, 400)
    return () => clearTimeout(timer)
  }, [scopeDraft])
  const [gatewayId, setGatewayId] = useState(defaultIpfsGateway.id)
  const gatewayRef = useRef(defaultIpfsGateway.template)
  const resourceLoadAbortRef = useRef<AbortController | undefined>(undefined)
  const [loadRequest, setLoadRequest] = useState<ConnectionOptions | undefined>(undefined)
  const [loadState, setLoadState] = useState<LoadState>(() => "failure" in viewerLink ? { status: "failed", failure: viewerLink.failure, integrityWarnings: [] } : { status: "setup" })
  const [wallet, setWallet] = useState<WalletState>(() => initialWalletState())
  const [walletChainMatches, setWalletChainMatches] = useState(true)
  const [walletRefreshing, setWalletRefreshing] = useState(false)
  const [walletAccountSynchronized, setWalletAccountSynchronized] = useState(true)
  const [notice, setNotice] = useState<Notice | undefined>(undefined)
  const [transactionNotice, setTransactionNotice] = useState<(Notice & { readonly transaction?: SubmittedTransactionReference }) | undefined>(undefined)
  const [preparedCall, setPreparedCallState] = useState<CamViewerPreparedContractCall | undefined>(undefined)
  const preparedCallRef = useRef<CamViewerPreparedContractCall | undefined>(undefined)
  const [sendStage, setSendStage] = useState<TransactionStage | undefined>(undefined)
  const sending = sendStage !== undefined
  const [changingView, setChangingView] = useState(false)
  const interactionRevision = useRef(0)
  const sendRevision = useRef(0)
  const sendingRef = useRef(false)
  const changingViewRef = useRef(false)
  const walletRefreshingRef = useRef(false)
  const walletAccountSynchronizedRef = useRef(true)
  const walletBindingRef = useRef<{ connect(): Promise<void>; resume(): Promise<void>; dispose(): void } | undefined>(undefined)
  const committedUrlRef = useRef(window.location.href)
  const browserHistoryRef = useRef<ReturnType<typeof createBrowserHistory> | undefined>(undefined)
  if (browserHistoryRef.current === undefined) browserHistoryRef.current = createBrowserHistory({
    get state() { return window.history.state },
    get href() { return window.location.href },
    replaceState: (state, unused, url) => window.history.replaceState(state, unused, url),
    pushState: (state, unused, url) => window.history.pushState(state, unused, url),
    go: delta => window.history.go(delta),
  }, crypto.getRandomValues(new Uint32Array(4)).join("-"))
  const browserHistory = browserHistoryRef.current
  const browserReadRef = useRef<BrowserVisit | undefined>(undefined)
  const readyRef = useRef(loadState)
  readyRef.current = loadState
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
    if (loadRequest === undefined) return
    const requestedConnection = loadRequest
    let cancelled = false
    const controller = new AbortController()
    resourceLoadAbortRef.current = controller
    let loadedSession: CamViewerSession | undefined
    const integrityWarnings: CamViewerLoadedSnapshot["integrityWarnings"][number][] = []

    async function load(): Promise<void> {
      try {
        const startup: StartupOptions = { ...requestedConnection, ...parseViewFragment(new URL(window.location.href).hash) }
        currentDownloadScope()
        const options = startup
        readyRef.current = { status: "loading", startup, integrityWarnings: [] }
        setLoadState(readyRef.current)
        const publicClient = createPublicClient({
          transport: http(startup.rpcUrl),
        })
        await assertRpcChain(publicClient, startup.chainId)
        await assertHostHasCode(publicClient, startup.host)
        const rpc = createRpcConnection({ url: startup.rpcUrl, client: publicClient })
        const session = createCamViewerSession({
          publicClient: rpc.client,
          host: {
            chainId: options.chainId,
            address: options.host,
          },
          account: {
            // The public EVM read subject is not a selected account or signer.
            address: options.account === undefined ? zeroAddress : options.account,
          },
          inputs: options.inputs,
          ...(options.route === undefined ? {} : { route: options.route }),
          onIntegrityWarning: warning => {
            if (cancelled || controller.signal.aborted) return
            integrityWarnings.push(warning)
            setLoadState(current => {
              if (cancelled || controller.signal.aborted || (current.status !== "loading" && current.status !== "failed")) return current
              return { ...current, integrityWarnings: [...integrityWarnings] }
            })
          },
          loadResource: uri => createViewerResourceLoader(assertCurrentDownloadAllowed, gatewayRef.current, controller.signal)(uri),
        })
        const snapshot = await session.load()
        loadedSession = session

        if (!cancelled && !controller.signal.aborted) {
          const ready = {
            status: "ready" as const,
            runtime: {
              viewingMode: startup.account === undefined ? "public" as const : "account" as const,
              startup,
              rpc,
              session,
            },
            snapshot,
          }
          commitSnapshot(ready, snapshot, "replace")
        }
      } catch (error) {
        if (!cancelled && !controller.signal.aborted) {
          setLoadState({
            status: "failed",
            failure: failureReport(error, "The app could not be loaded. Check the connection settings and technical details below."),
            startup: requestedConnection,
            integrityWarnings: [...integrityWarnings],
          })
        }
      }
    }

    void load()

    return () => {
      cancelled = true
      controller.abort()
      if (loadedSession !== undefined) {
        const documentHashes = loadedSession.snapshot().documentHashes
        if (documentHashes !== undefined) {
          for (const name of Object.keys(documentHashes)) loadedSession.cancelDocumentHash(name)
        }
      }
    }
  }, [loadRequest])

  const connection = connectionOptions(loadState)
  useEffect(() => {
    setWallet(initialWalletState())
    walletRefreshingRef.current = false
    walletAccountSynchronizedRef.current = true
    setWalletRefreshing(false)
    setWalletAccountSynchronized(true)
    setWalletChainMatches(true)
    if (connection === undefined) return
    const binding = createInjectedWalletBinding({
      chainId: connection.chainId,
      connect: () => connectInjectedWallet(connectionOptions(readyRef.current)!),
      isViewBusy: () => changingViewRef.current,
      setAccount: async address => {
        const current = readyRef.current
        if (current.status !== "ready") return { type: "startup" as const, address }
        setViewChanging(true)
        try {
          const snapshot = await current.runtime.session.setAccount({ address })
          await browserHistory.settled()
          return { type: "view" as const, session: current.runtime.session, snapshot }
        } finally { setViewChanging(false) }
      },
      commitAccount: result => {
        if (result.type === "startup") {
          const startup = connectionOptions(readyRef.current)
          if (startup === undefined) return
          const url = new URL(window.location.href)
          url.searchParams.set("account", result.address)
          window.history.replaceState(window.history.state, "", url)
          // The prior load may have completed since setAccount chose startup.
          // Its read subject must not survive this explicit account selection.
          restartLoad({ ...startup, account: result.address })
          return
        }
        const current = readyRef.current
        if (current.status !== "ready" || current.runtime.session !== result.session) return
        current.runtime.viewingMode = "account"
        commitSnapshot(current, result.snapshot, "replace")
      },
      invalidate: invalidatePreparedInteraction,
      onState: state => {
        walletRefreshingRef.current = state.refreshing
        walletAccountSynchronizedRef.current = state.accountSynchronized
        setWallet(state.wallet)
        setWalletRefreshing(state.refreshing)
        setWalletAccountSynchronized(state.accountSynchronized)
        setWalletChainMatches(state.chainMatches)
        if (!state.chainMatches) {
          showError({ message: `Wallet network differs from viewer chain ${connection.chainId}. Change the network in your wallet, then use Reconnect wallet. The app stays on its configured network.` }, false)
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
  }, [connection?.chainId, connection?.host])

  useEffect(() => {
    async function openBrowserVisit(target: BrowserVisit): Promise<void> {
      const current = readyRef.current
      if (current.status !== "ready") {
        window.location.reload()
        return
      }
      if (browserReadRef.current !== undefined) {
        browserHistory.restore(browserReadRef.current.position)
        showStatus("Finish the current operation before opening another view.", false)
        return
      }
      if (sendingRef.current || viewInteractionBlocked()) {
        browserHistory.restore("committed")
        showStatus("Finish the current operation before opening another view.", false)
        return
      }
      browserReadRef.current = target
      const revision = nextInteractionRevision()
      setPreparedCall(undefined)
      setNotice(undefined)
      setViewChanging(true)
      try {
        let snapshot = target.visitId === undefined ? undefined : await current.runtime.session.traverse(target.visitId)
        if (snapshot === undefined) {
          const requested = parseViewFragment(new URL(target.href).hash)
          snapshot = await current.runtime.session.navigate(requested.route, requested.inputs)
        }
        await browserHistory.settled()
        if (browserHistory.isCurrent(target)) {
          commitSnapshot(current, snapshot, target)
          if (isCurrentInteraction(revision)) arriveAtFeedback("view")
        }
      } catch (error) {
        await browserHistory.settled()
        if (browserHistory.isCurrent(target)) {
          browserHistory.restore("committed")
          if (isCurrentInteraction(revision)) showError(failureReport(error, "Cannot open the requested view. The previous view is kept."), true)
        }
      } finally {
        browserReadRef.current = undefined
        setViewChanging(false)
      }
    }
    const onNavigation = () => {
      const target = browserHistory.observe()
      if (target !== undefined) void openBrowserVisit(target)
    }
    window.addEventListener("popstate", onNavigation)
    window.addEventListener("hashchange", onNavigation)
    return () => {
      window.removeEventListener("popstate", onNavigation)
      window.removeEventListener("hashchange", onNavigation)
    }
  }, [])

  async function dispatch(action: ResolvedButtonNode): Promise<void> {
    if (sendingRef.current || viewInteractionBlocked()) return
    const ready = requireReadyState(loadState)
    if (ready.runtime.viewingMode === "public" && ready.runtime.session.actionKind(action) === "contractCall") {
      showError({ message: "Connect a wallet before reviewing a transaction." }, true)
      return
    }
    const revision = nextInteractionRevision()
    setNotice(undefined)
    setPreparedCall(undefined)

    try {
      setViewChanging(true)
      let result
      try {
        result = await ready.runtime.session.dispatchAction(action)
        await browserHistory.settled()
        if (result.type === "navigated") commitSnapshot(ready, result.snapshot, "push")
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
      if (error instanceof CamViewerInputError) {
        commitSnapshot(ready, error.snapshot, "replace")
        showError({ message: error.message }, true)
        return
      }
      showError(actionFailure(error, action.props.label), true)
    }
  }

  async function preflightPreparedCall(call: CamViewerPreparedContractCall): Promise<void> {
    const ready = requireReadyState(loadState)
    const account = wallet.status === "connected" ? wallet.address : currentViewerAccount(ready)
    if (account === undefined) throw new UserFacingError("Connect a wallet before reviewing a transaction.")
    await simulateCamContractCall({
      publicClient: ready.runtime.rpc.active.client,
      account,
      call,
    })
  }

  async function connectWallet(): Promise<void> {
    if (sendingRef.current || changingViewRef.current || walletRefreshingRef.current) return
    await walletBindingRef.current?.connect()
  }

  async function goBack(): Promise<void> {
    if (sendingRef.current || viewInteractionBlocked() || !browserHistory.canGoBack()) return
    invalidatePreparedInteraction()
    browserHistory.back()
  }

  async function refreshIntegrity(warning: CamIntegrityWarning, signal: AbortSignal): Promise<CamIntegrityCheck> {
    const current = readyRef.current
    const startup = current.status === "ready" ? current.runtime.startup : current.status === "setup" ? undefined : current.startup
    if (startup === undefined) throw new UserFacingError("Cannot refresh these hashes without the app's connection settings.")
    const publicClient = current.status === "ready" ? current.runtime.rpc.client : createPublicClient({ transport: http(startup.rpcUrl) })
    return checkCamResourceIntegrity({
      publicClient,
      host: { chainId: startup.chainId, address: startup.host },
      loadResource: createViewerResourceLoader(assertCurrentDownloadAllowed, gatewayRef.current, signal),
      resource: warning,
    })
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
      await browserHistory.settled()
      commitSnapshot(ready, snapshot, "replace")
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
    let submittedTransaction: SubmittedTransactionReference | undefined
    let reverted = false

    // React disables the button after state commit, but a second click can
    // enter this handler before that render. The ref is the synchronous
    // transaction-submission gate.
    sendingRef.current = true
    cancelPendingDocumentHashes()
    setSendStage("checking")
    setNotice(undefined)
    try {
      const ready = requireReadyState(loadState)
      const txHash = await submitPreparedContractCall({
        ports: PREPARED_CALL_SUBMITTER_PORTS,
        publicClient: ready.runtime.rpc.active.client,
        walletAddress: wallet.address,
        startup: { ...ready.runtime.startup, rpcUrl: ready.runtime.rpc.active.url },
        call,
        shouldContinue: () => ownsInteraction() && ownsSend(),
        onStage: stage => { if (ownsSend()) setSendStage(stage) },
      })
      if (txHash === undefined) return
      submittedTransaction = { chainId: ready.runtime.startup.chainId, hash: txHash }
      if (!ownsSend()) return
      reportTransaction({ message: "Transaction submitted." }, "status", false, submittedTransaction)
      setSendStage("confirming")

      const nonceGap = await submittedTransactionDiagnosis({
        client: ready.runtime.rpc.active.client,
        txHash,
        rpcEndpoint: displayRpcEndpoint(ready.runtime.rpc.active.url),
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
      reportTransaction({ message: `Transaction confirmed in block ${receipt.blockNumber.toString()}.` }, "status", ownsInteraction(), submittedTransaction)
      if (ownsInteraction()) {
        setPreparedCall(undefined)
      }

      if (call.then.namespace === "routes" && ownsInteraction()) {
        setSendStage("refreshing")
        try {
          setViewChanging(true)
          try {
            const snapshot = await ready.runtime.session.navigate(call.then.function, call.then.args)
            await browserHistory.settled()
            if (!ownsSend()) return
            commitSnapshot(ready, snapshot, "push")
          } finally {
            setViewChanging(false)
          }
        } catch (error) {
          if (!ownsInteraction() || !ownsSend()) return
          showError(failureReport(error, "The transaction is confirmed, but the view could not be refreshed. Refresh the view to check its current values."), true)
        }
      }
    } catch (error) {
      if (!ownsSend() || (submittedTransaction === undefined && !(error instanceof SubmissionOutcomeUnknownError) && !ownsInteraction())) return
      if (submittedTransaction !== undefined) {
        if (ownsInteraction()) {
          setPreparedCall(undefined)
        }
        reportTransaction(failureReport(error, reverted
          ? "Transaction reverted."
          : "Transaction submitted, but confirmation could not be checked. Check its status before sending another transaction."), "error", ownsInteraction(), submittedTransaction)
      } else if (error instanceof SubmissionOutcomeUnknownError) {
        if (ownsInteraction()) setPreparedCall(undefined)
        reportTransaction(failureReport(error.cause, "The transaction may have been sent, but the wallet did not return a transaction hash. Check your wallet before trying again."), "error", ownsInteraction())
      } else {
        showError(failureReport(error, "Transaction not sent."), true)
      }
    } finally {
      sendingRef.current = false
      if (ownsSend()) {
        setSendStage(undefined)
      }
    }
  }

  function updateInput(name: string, value: string | null): void {
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
    const current = readyRef.current
    if (current.status !== "ready") return
    const session = current.runtime.session
    const documentHashes = session.snapshot().documentHashes
    if (documentHashes === undefined) return
    let snapshot = current.snapshot
    for (const [name, status] of Object.entries(documentHashes)) {
      if (status.status === "pending") snapshot = session.cancelDocumentHash(name)
    }
    if (snapshot !== current.snapshot) setLoadState({ ...current, snapshot })
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
          digest = await calculateDocumentHashFromURL(operation.sourceURI, operation.signal, assertCurrentDownloadAllowed, gatewayRef.current)
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
    mode: "push" | "replace" | BrowserVisit,
  ): void {
    readyRef.current = { ...ready, snapshot }
    setLoadState(readyRef.current)
    const currentUrl = urlForActiveConnection(new URL(window.location.href), ready.runtime.rpc.active.url)
    const account = currentViewerAccount(readyRef.current)
    if (account !== undefined) currentUrl.searchParams.set("account", account)
    else currentUrl.searchParams.delete("account")
    try {
      const nextUrl = urlForView(currentUrl, { route: snapshot.route, inputs: snapshot.inputs, ...(account === undefined ? {} : { account: { address: account } }) })
      browserHistory.commit(snapshot.visitId, nextUrl.href, mode)
      committedUrlRef.current = nextUrl.href
    } catch (error) {
      // The read succeeded. Do not misreport it as a lookup failure merely
      // because its inputs cannot be represented by the URL boundary.
      const previousUrl = urlForActiveConnection(new URL(committedUrlRef.current), ready.runtime.rpc.active.url)
      if (account !== undefined) previousUrl.searchParams.set("account", account)
      else previousUrl.searchParams.delete("account")
      browserHistory.commit(snapshot.visitId, previousUrl.href, mode)
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

  function reportTransaction(report: FailureReport, kind: Notice["kind"], focus: boolean, transaction?: SubmittedTransactionReference): void {
    setTransactionNotice({ ...report, kind, ...(transaction === undefined ? {} : { transaction }) })
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

  function retryUnfinishedLoad(): void {
    if (readyRef.current.status === "ready") return
    restartLoad(connectionOptions(readyRef.current))
  }

  function restartLoad(startup: ConnectionOptions | undefined): void {
    if (startup === undefined) return
    resourceLoadAbortRef.current?.abort()
    const request = { ...startup }
    readyRef.current = { status: "loading", startup: request, integrityWarnings: [] }
    setLoadState(readyRef.current)
    setLoadRequest(request)
  }

  async function applyRpc(url: string): Promise<void> {
    if (sendingRef.current || changingViewRef.current || walletRefreshingRef.current) throw new UserFacingError("Finish the current operation before changing RPC.")
    const current = readyRef.current
    if (current.status !== "ready") {
      if (current.status === "loading" && current.startup?.rpcUrl === url) return
      // silent-defaults: allow-default -- Retry keeps bootstrap account changes; untouched setup uses the supplied link coordinates.
      const coordinates = connectionOptions(current) ?? ("coordinates" in viewerLink ? viewerLink.coordinates : undefined)
      if (coordinates === undefined) throw new UserFacingError("Provide the app's network and CAM contract address first.")
      restartLoad({ ...coordinates, rpcUrl: url })
      return
    }
    setViewChanging(true)
    try {
      const client = createPublicClient({ transport: http(url) })
      await assertRpcChain(client, current.runtime.startup.chainId)
      await assertHostHasCode(client, current.runtime.startup.host)
      await browserHistory.settled()
      const snapshot = await current.runtime.rpc.refresh({ url, client }, current.runtime.session)
      invalidatePreparedInteraction()
      commitSnapshot(current, snapshot, "replace")
    } finally { setViewChanging(false) }
  }

  function currentDownloadScope(): DownloadScope {
    if (downloadScopeRef.current === undefined) return readStartupPolicy({ VITE_CAM_WEB_RESOURCE_ORIGIN: bootResourceSetting })
    return downloadScopeRef.current
  }

  function assertCurrentDownloadAllowed(uri: string): void {
    try { assertDownloadAllowed(uri, currentDownloadScope()) }
    catch (cause) { throw new UserFacingError("Cannot download this resource. Check its URL and the selected download scope.", { cause }) }
  }

  function commitDownloadScope(scope: DownloadScope): void {
    downloadScopeRef.current = scope
    setScopeError(undefined)
    if (readyRef.current.status === "failed") retryUnfinishedLoad()
  }

  function editScope(next: typeof scopeDraft): void {
    scopeDraftRef.current = next
    setScopeDraft(next)
    setScopeError(undefined)
    try {
      if (next.choice === "boot") commitDownloadScope(readStartupPolicy({ VITE_CAM_WEB_RESOURCE_ORIGIN: bootResourceSetting }))
      else if (next.choice === "https-or-ipfs" || next.choice === "ipfs-only" || next.choice === "http-only") commitDownloadScope({ kind: next.choice })
    } catch (cause) { setScopeError(failureReport(cause, "Cannot use this download scope.")) }
  }

  const resourcePolicy = <ControlRow className="download-scope" label="Download scope" controlId="download-scope-choice">
    <div className="connection-form">
      <select id="download-scope-choice" value={scopeDraft.choice} onChange={event => editScope({ ...scopeDraft, choice: event.currentTarget.value })}>
        <option value="https-or-ipfs">HTTPS or IPFS</option>
        <option value="ipfs-only">IPFS only</option>
        <option value="http-only">HTTP only (danger!)</option>
        {bootPrefix === undefined ? null : <option value="boot">Only {bootPrefix.length <= 64 ? bootPrefix : `${bootPrefix.slice(0, 61)}…`}</option>}
        <option value="custom">Custom URL prefix</option>
      </select>
      {scopeDraft.choice === "boot" && bootPrefix !== undefined ? <label className="field"><span className="visually-hidden">Configured URL prefix</span><input readOnly value={bootPrefix} /></label> : null}
      {scopeDraft.choice === "custom" ? <label className="field"><span className="visually-hidden">URL prefix</span><input id="download-prefix" type="url" value={scopeDraft.prefix} placeholder="https://example.org/app/" onChange={event => editScope({ ...scopeDraft, prefix: event.currentTarget.value })} /></label> : null}
      {scopeError === undefined ? null : <Feedback report={scopeError} kind="error" />}
    </div>
  </ControlRow>

  const gatewayControl = <ControlRow className="ipfs-gateway" label="IPFS gateway" controlId="ipfs-gateway-choice">
          <select id="ipfs-gateway-choice" value={gatewayId} aria-describedby="ipfs-gateway-help" onChange={event => {
            const selected = publicIpfsGateways.find(gateway => gateway.id === event.currentTarget.value)!
            gatewayRef.current = selected.template
            setGatewayId(selected.id)
            if (readyRef.current.status === "failed") retryUnfinishedLoad()
          }}>
            {publicIpfsGateways.map(gateway => <option key={gateway.id} value={gateway.id}>{gateway.name}</option>)}
          </select>
          <span id="ipfs-gateway-help" className="visually-hidden">Used for new IPFS downloads.</span>
      </ControlRow>

  const rpcControl = "coordinates" in viewerLink ? <RpcControls
    chainId={viewerLink.coordinates.chainId}
    suppliedURLs={viewerLink.rpcURLs}
    activeURL={loadState.status === "ready" ? loadState.runtime.rpc.active.url : undefined}
    busy={changingView || walletRefreshing || sending}
    mode="connection"
    onApply={applyRpc}
  /> : null
  // silent-defaults: allow-default -- Show known app coordinates before an RPC has been selected.
  const displayedConnection = connection ?? ("coordinates" in viewerLink ? viewerLink.coordinates : undefined)

  return (
    <DownloadContext value={{ gateway: gatewayRef.current, assertAllowed: assertCurrentDownloadAllowed }}>
    <main className="app-shell">
      <header className="topbar">
        <h1>{"coordinates" in viewerLink ? headerTitle(loadState) : "Open app"}</h1>
      </header>
      {"coordinates" in viewerLink ? null : <AppSetup rpcURLs={viewerLink.rpcURLs} onOpen={request => {
        const { rpcUrl, ...coordinates } = request
        setViewerLink({ coordinates, rpcURLs: [rpcUrl] })
        restartLoad({ ...coordinates, rpcUrl })
      }} />}
      {displayedConnection !== undefined ? (
        <ConnectionSummary
          chainId={displayedConnection.chainId}
          host={displayedConnection.host}
          account={loadState.status === "ready" ? currentViewerAccount(loadState) : displayedConnection.account}
          wallet={wallet.status === "connected" ? wallet.address : undefined}
          walletAction={(
            <button className="wallet-button" type="button" aria-busy={walletRefreshing} disabled={wallet.status === "unavailable" || connection === undefined || changingView || walletRefreshing || sending} onClick={() => { void connectWallet() }}>
              {walletRefreshing ? "Updating account…" : wallet.status === "unavailable" ? "Wallet not detected" : wallet.status === "connected" ? "Reconnect wallet" : "Connect wallet"}
            </button>
          )}
        >{rpcControl}{resourcePolicy}{gatewayControl}</ConnectionSummary>
      ) : <div className="connection connection-facts">{resourcePolicy}{gatewayControl}</div>}

      {loadState.status === "setup" ? null : <IntegrityWarnings key={JSON.stringify([loadRequest?.chainId, loadRequest?.host, loadState.status === "ready" ? loadState.runtime.rpc.active.url : loadRequest?.rpcUrl])} warnings={loadState.status === "ready" ? loadState.snapshot.integrityWarnings : loadState.integrityWarnings} onRefresh={refreshIntegrity} />}
      {notice === undefined ? null : (
        <Feedback report={notice} kind={notice.kind} className="notice" messageRef={noticeRef} />
      )}
      {transactionNotice === undefined ? null : (
        <section className="transaction-feedback" aria-label="Transaction outcome">
          <TransactionFeedback report={transactionNotice} kind={transactionNotice.kind} transaction={transactionNotice.transaction} messageRef={transactionNoticeRef} />
        </section>
      )}
      {preparedCall === undefined ? null : (
        <PreparedCallView
          call={preparedCall}
          reviewRef={preparedRef}
          canSend={wallet.status === "connected" && walletChainMatches && walletAccountSynchronized && !changingView && !walletRefreshing}
          canDiscard={!changingView && !walletRefreshing}
          stage={sendStage}
          onSend={sendPreparedCall}
          onDiscard={discardPreparedCall}
        />
      )}

      {loadState.status === "loading" ? (
        <section className="panel">Loading app...</section>
      ) : null}

      {loadState.status === "setup" ? <section className="panel">Choose an RPC service to open this app.</section> : null}

      {loadState.status === "failed" && "coordinates" in viewerLink ? (
        <section className="panel error">
          <h2>Cannot load app</h2>
          <Feedback report={loadState.failure} kind="error" />
          <button type="button" onClick={() => {
            resourceLoadAbortRef.current?.abort()
            setNotice(undefined)
            const rpcURLs = loadState.startup === undefined ? viewerLink.rpcURLs : [loadState.startup.rpcUrl]
            setViewerLink({ failure: loadState.failure, rpcURLs })
            setLoadRequest(undefined)
            readyRef.current = { status: "setup" }
            setLoadState(readyRef.current)
          }}>Edit app connection</button>
          {connection === undefined ? null : <button type="button" onClick={retryUnfinishedLoad}>Retry loading</button>}
        </section>
      ) : null}

      {loadState.status === "ready" ? (
        <UiView
          snapshot={{ ...loadState.snapshot, canGoBack: browserHistory.canGoBack() }}
          actionKind={loadState.runtime.session.actionKind}
          canReviewTransaction={loadState.runtime.viewingMode === "account"}
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
    </DownloadContext>
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
    client: ready.runtime.rpc.active.client,
    txHash,
    rpcEndpoint: displayRpcEndpoint(ready.runtime.rpc.active.url),
    pollingIntervalMs: RECEIPT_POLLING_INTERVAL_MS,
    timeoutMs: RECEIPT_WAIT_TIMEOUT_MS,
  })
}

function headerTitle(loadState: LoadState): string {
  if (loadState.status === "setup") return "Open app"
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
  return loadState.runtime.viewingMode === "public" ? undefined : loadState.snapshot.account?.address
}

function connectionOptions(state: LoadState): ConnectionOptions | undefined {
  if (state.status === "setup") return undefined
  return state.status === "ready" ? { ...state.runtime.startup, rpcUrl: state.runtime.rpc.active.url } : state.startup
}
