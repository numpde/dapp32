import {
  useEffect,
  useRef,
  useState,
} from "react"
import type { ReactElement } from "react"

import {
  createHttpCamPublicClient,
} from "@cam/evm-viem"
import type {
  CamHost,
  ResourceLoader,
} from "@cam/evm-viem"
import {
  toInertValue,
} from "@cam/protocol"
import type {
  InertRecord,
  InertValue,
} from "@cam/protocol"
import type {
  ContractCallAction,
  ResolvedScreenAction,
  ResolvedScreenElement,
} from "@cam/screen"
import {
  createCamViewerSession,
} from "@cam/viewer"
import type {
  CamViewerSession,
  CamViewerSnapshot,
} from "@cam/viewer"

type StartupOptions = {
  readonly chainId: string
  readonly host: CamHost["address"]
  readonly account: CamHost["address"]
  readonly rpcUrl: string
  readonly allowUnsignedCamHash: boolean
}

type LoadState =
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly snapshot: CamViewerSnapshot }
  | { readonly status: "failed"; readonly message: string }

type PreparedCall = ContractCallAction

export function App(): ReactElement {
  const sessionRef = useRef<CamViewerSession | undefined>(undefined)
  const [options, setOptions] = useState<StartupOptions | undefined>(undefined)
  const [loadState, setLoadState] = useState<LoadState>({ status: "loading" })
  const [notice, setNotice] = useState<string | undefined>(undefined)
  const [preparedCall, setPreparedCall] = useState<PreparedCall | undefined>(undefined)

  useEffect(() => {
    let cancelled = false

    async function load(): Promise<void> {
      try {
        const startup = parseStartupOptions(new URL(window.location.href))
        const session = createCamViewerSession({
          publicClient: createHttpCamPublicClient({ rpcURL: startup.rpcUrl }),
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

      setPreparedCall(result.action)
      setNotice("Prepared contract call. No wallet sender is connected in this viewer.")
    } catch (error) {
      setNotice(errorMessage(error))
    }
  }

  function updateInput(name: string, value: string): void {
    const session = requireSession(sessionRef.current)
    try {
      setLoadState({
        status: "ready",
        snapshot: session.updateForm({ [name]: toInertValue(value) } satisfies InertRecord),
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
              <dd>{shorten(options.host)}</dd>
            </div>
            <div>
              <dt>Account</dt>
              <dd>{shorten(options.account)}</dd>
            </div>
          </dl>
        )}
      </header>

      {notice === undefined ? null : <p className="notice">{notice}</p>}
      {preparedCall === undefined ? null : <PreparedCallView action={preparedCall} />}

      {loadState.status === "loading" ? (
        <section className="panel">Loading CAM session...</section>
      ) : null}

      {loadState.status === "failed" ? (
        <section className="panel error">
          <h2>Cannot load viewer</h2>
          <p>{loadState.message}</p>
          <p className="hint">
            Required URL params: <code>chainId</code>, <code>host</code>, <code>account</code>, <code>rpcUrl</code>,{" "}
            <code>allowUnsignedCamHash</code>.
          </p>
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
  action,
}: {
  readonly action: PreparedCall
}): ReactElement {
  return (
    <section className="panel prepared-call">
      <h2>Prepared contract call</h2>
      <KeyValue label="Contract" value={action.contract} />
      <KeyValue label="Function" value={action.function} />
      <KeyValue label="Args" value={formatInertValue(action.args)} />
      {action.onSuccess === undefined ? null : <KeyValue label="On success" value={`${action.onSuccess.route} ${formatInertValue(action.onSuccess.params)}`} />}
      <button className="send-button" type="button" disabled>
        Send unavailable
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

function parseStartupOptions(url: URL): StartupOptions {
  const params = url.searchParams
  return {
    chainId: requireChainId(requiredParam(params, "chainId")),
    host: requireAddress(requiredParam(params, "host"), "host"),
    account: requireAddress(requiredParam(params, "account"), "account"),
    rpcUrl: requireHttpURL(requiredParam(params, "rpcUrl"), "rpcUrl").href,
    allowUnsignedCamHash: requiredBooleanParam(params, "allowUnsignedCamHash"),
  }
}

function createPinnedOriginResourceLoader(): ResourceLoader {
  let origin: string | undefined

  return async (uri: string): Promise<Uint8Array> => {
    const url = requireHttpURL(uri, "CAM resource URI")
    if (origin === undefined) {
      origin = url.origin
    } else if (url.origin !== origin) {
      throw new Error(`CAM resource escaped pinned origin: ${url.href}`)
    }

    const response = await fetch(url, { redirect: "error" })
    if (!response.ok) {
      throw new Error(`failed to load CAM resource ${url.href}: HTTP ${response.status}`)
    }

    return new Uint8Array(await response.arrayBuffer())
  }
}

function requiredParam(params: URLSearchParams, name: string): string {
  const value = params.get(name)
  if (value === null || value.length === 0) {
    throw new Error(`missing URL parameter: ${name}`)
  }

  return value
}

function requiredBooleanParam(params: URLSearchParams, name: string): boolean {
  const value = requiredParam(params, name)
  if (value === "true") return true
  if (value === "false") return false
  throw new Error(`${name}: expected "true" or "false"`)
}

function requireHttpURL(value: string, label: string): URL {
  const url = new URL(value)
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`${label}: expected http or https URL`)
  }
  if (url.username !== "" || url.password !== "") {
    throw new Error(`${label}: credentials are not allowed`)
  }

  return url
}

function requireChainId(value: string): string {
  if (!/^eip155:[1-9][0-9]*$/.test(value)) {
    throw new Error("chainId: expected CAIP-2 EVM chain id, for example eip155:31337")
  }

  return value
}

function requireAddress(value: string, label: string): CamHost["address"] {
  if (!/^0x[0-9a-fA-F]{40}$/.test(value)) {
    throw new Error(`${label}: expected 20-byte hex address`)
  }

  return value as CamHost["address"]
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

function shorten(address: string): string {
  return address.length > 14 ? `${address.slice(0, 6)}...${address.slice(-4)}` : address
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
