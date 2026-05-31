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
  InertValue,
} from "@cam/protocol"
import type {
  ResolvedScreenAction,
  ResolvedScreenElement,
} from "@cam/screen"
import {
  createCamViewerSession,
} from "@cam/viewer"
import type {
  CamViewerPreparedContractCall,
  CamViewerSession,
  CamViewerSnapshot,
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
  shortenAddress,
} from "./evm"
import {
  createPinnedOriginResourceLoader,
  parseStartupOptions,
} from "./startup"
import type { StartupOptions } from "./startup"

type LoadState =
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly snapshot: CamViewerSnapshot }
  | { readonly status: "failed"; readonly message: string }

export function App(): ReactElement {
  const sessionRef = useRef<CamViewerSession | undefined>(undefined)
  const publicClientRef = useRef<ReturnType<typeof createPublicClient> | undefined>(undefined)
  const [options, setOptions] = useState<StartupOptions | undefined>(undefined)
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
          sessionRef.current = session
          publicClientRef.current = publicClient
          setOptions(startup)
          setLoadState({ status: "ready", snapshot })
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
    const session = requireSession(sessionRef.current)
    setNotice(undefined)
    setPreparedCall(undefined)

    try {
      const result = await session.dispatchAction(action)
      if (result.type === "navigated") {
        setLoadState({ status: "ready", snapshot: result.snapshot })
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
    const startup = requireOptions(options)
    await simulateCamContractCall({
      publicClient: requirePublicClient(publicClientRef.current),
      account: wallet.status === "connected" ? wallet.address : currentViewerAccount(loadState, startup.account),
      call,
    })
  }

  async function connectWallet(): Promise<void> {
    try {
      const startup = requireOptions(options)
      const address = await connectInjectedWallet(startup)
      const session = requireSession(sessionRef.current)
      const snapshot = await session.setAccount({ address })

      setWallet({ status: "connected", address })
      setLoadState({ status: "ready", snapshot })
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
      const publicClient = requirePublicClient(publicClientRef.current)
      await simulateCamContractCall({
        publicClient,
        account: wallet.address,
        call,
      })
      const startup = requireOptions(options)
      await ensureInjectedWalletChain(startup)
      const walletClient = createInjectedWalletClient(wallet.address)
      const txHash = await sendCamContractCall({ walletClient, call })
      setNotice(`Transaction sent: ${txHash}`)

      const receipt = await publicClient.waitForTransactionReceipt({
        hash: txHash,
      })
      if (receipt.status !== "success") {
        throw new Error(`Transaction reverted: ${txHash}`)
      }
      setNotice(`Transaction confirmed in block ${receipt.blockNumber.toString()}.`)
      setPreparedCall(undefined)

      if (call.onSuccess !== undefined) {
        const session = requireSession(sessionRef.current)
        const result = await session.dispatchAction(call.onSuccess)
        if (result.type === "navigated") {
          setLoadState({ status: "ready", snapshot: result.snapshot })
        }
      }
    } catch (error) {
      setNotice(errorMessage(error))
    } finally {
      setSending(false)
    }
  }

  function updateInput(name: string, value: string): void {
    const session = requireSession(sessionRef.current)
    try {
      setPreparedCall(undefined)
      setLoadState({
        status: "ready",
        snapshot: session.updateForm({ [name]: value }),
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
        {options === undefined ? null : (
          <dl className="connection">
            <div>
              <dt>Chain</dt>
              <dd>{options.chainId}</dd>
            </div>
            <div>
              <dt>Host</dt>
              <dd>{shortenAddress(options.host)}</dd>
            </div>
            <div>
              <dt>Viewer account</dt>
              <dd>{shortenAddress(currentViewerAccount(loadState, options.account))}</dd>
            </div>
            <div>
              <dt>Wallet</dt>
              <dd>{walletLabel(wallet)}</dd>
            </div>
          </dl>
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
        <section className="screen">
          <div className="screen-meta">
            <span>{loadState.snapshot.route}</span>
            <span>{loadState.snapshot.screenURI}</span>
          </div>
          <div className="elements">
            {(loadState.snapshot.resolvedScreen?.elements ?? []).map((element, index) => (
              <ScreenElementView
                key={index}
                element={element}
                onAction={dispatch}
                onInput={updateInput}
              />
            ))}
          </div>
        </section>
      ) : null}
    </main>
  )
}

function PreparedCallView({
  call,
  canSend,
  sending,
  onSend,
}: {
  readonly call: CamViewerPreparedContractCall
  readonly canSend: boolean
  readonly sending: boolean
  readonly onSend: (call: CamViewerPreparedContractCall) => Promise<void>
}): ReactElement {
  return (
    <section className="panel prepared-call">
      <h2>Prepared contract call</h2>
      <KeyValue label="Contract" value={call.contract} />
      <KeyValue label="Address" value={call.address} mono />
      <KeyValue label="Function" value={call.function} />
      <KeyValue label="Args" value={formatInertValue(call.args)} />
      {call.onSuccess === undefined ? null : <KeyValue label="On success" value={`${call.onSuccess.route} ${formatInertValue(call.onSuccess.params)}`} />}
      <button
        className="send-button"
        type="button"
        disabled={!canSend || sending}
        onClick={() => {
          void onSend(call)
        }}
      >
        {sending ? "Sending..." : "Send with wallet"}
      </button>
    </section>
  )
}

function ScreenElementView({
  element,
  onAction,
  onInput,
}: {
  readonly element: ResolvedScreenElement
  readonly onAction: (action: ResolvedScreenAction) => Promise<void>
  readonly onInput: (name: string, value: string) => void
}): ReactElement {
  switch (element.type) {
    case "text":
      return <p className="text-row">{element.text}</p>
    case "input":
      return (
        <label className="field">
          <span>{element.label}</span>
          <input
            value={inertToInputValue(element.value)}
            onChange={(event) => onInput(element.name, event.currentTarget.value)}
          />
        </label>
      )
    case "address":
      return <KeyValue label={element.label ?? "Address"} value={element.address} mono />
    case "status":
      return <KeyValue label={element.label ?? "Status"} value={formatInertValue(element.value)} />
    case "nft":
      return (
        <div className="nft-row">
          <KeyValue label="NFT contract" value={element.contractAddress} mono />
          <KeyValue label="Token ID" value={formatInertValue(element.tokenId)} />
        </div>
      )
    case "button":
      return (
        <button
          className={`action-button ${element.action.type === "contract-call" ? "write-action" : ""}`}
          type="button"
          onClick={() => {
            void onAction(element.action)
          }}
        >
          {element.label}
        </button>
      )
  }
}

function KeyValue({
  label,
  value,
  mono = false,
}: {
  readonly label: string
  readonly value: string
  readonly mono?: boolean
}): ReactElement {
  return (
    <div className="key-value">
      <span className="key-label">{label}</span>
      <span className={mono ? "mono" : undefined}>{value}</span>
    </div>
  )
}

function requireOptions(options: StartupOptions | undefined): StartupOptions {
  if (options === undefined) {
    throw new Error("CAM viewer startup options are not loaded")
  }

  return options
}

function requirePublicClient(client: ReturnType<typeof createPublicClient> | undefined): ReturnType<typeof createPublicClient> {
  if (client === undefined) {
    throw new Error("CAM viewer public client is not loaded")
  }

  return client
}

async function assertHostHasCode(
  publicClient: ReturnType<typeof createPublicClient>,
  host: StartupOptions["host"],
): Promise<void> {
  const code = await publicClient.getCode({ address: host })
  if (code === undefined || code === "0x") {
    throw new Error(`CAM host has no contract code at ${host}. Check that the host URL parameter matches the currently running chain.`)
  }
}

function requireSession(session: CamViewerSession | undefined): CamViewerSession {
  if (session === undefined) {
    throw new Error("CAM viewer session is not loaded")
  }

  return session
}

function inertToInputValue(value: InertValue): string {
  if (value === null) return ""
  return typeof value === "string" ? value : formatInertValue(value)
}

function formatInertValue(value: InertValue): string {
  if (value === null) return "null"
  if (typeof value === "string") return value
  if (typeof value === "number" || typeof value === "boolean") return String(value)
  return JSON.stringify(value)
}

function currentViewerAccount(loadState: LoadState, fallback: StartupOptions["account"]): StartupOptions["account"] {
  return loadState.status === "ready" && loadState.snapshot.account !== undefined
    ? loadState.snapshot.account.address
    : fallback
}
