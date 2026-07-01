import type { ReactElement } from "react"

import type { InertValue } from "@cam/protocol"
import type {
  ResolvedButtonNode,
  ResolvedUiNode,
} from "@cam/screen"
import type {
  CamViewerLoadedSnapshot,
  CamViewerPreparedContractCall,
} from "@cam/viewer"

import {
  shortenAddress,
} from "./evm.ts"

export function ConnectionSummary({
  chainId,
  host,
  account,
  wallet,
}: {
  readonly chainId: string
  readonly host: string
  readonly account: string
  readonly wallet: string
}): ReactElement {
  return (
    <dl className="connection">
      <div>
        <dt>Chain</dt>
        <dd>{chainId}</dd>
      </div>
      <div>
        <dt>Host</dt>
        <dd>{shortenAddress(host)}</dd>
      </div>
      <div>
        <dt>Viewer account</dt>
        <dd>{shortenAddress(account)}</dd>
      </div>
      <div>
        <dt>Wallet</dt>
        <dd>{wallet}</dd>
      </div>
    </dl>
  )
}

export function UiView({
  snapshot,
  onAction,
  onInput,
}: {
  readonly snapshot: CamViewerLoadedSnapshot
  readonly onAction: (action: ResolvedButtonNode) => Promise<void>
  readonly onInput: (name: string, value: string) => void
}): ReactElement {
  return (
    <section className="ui">
      <div className="ui-meta">
        <span>{snapshot.route}</span>
        <span>{snapshot.uiURI}</span>
      </div>
      <div className="elements">
        <UiNodeView node={snapshot.resolvedUi} state={snapshot.state} onAction={onAction} onInput={onInput} />
      </div>
    </section>
  )
}

export function PreparedCallView({
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
      <KeyValue label="Route" value={call.route} mono={false} />
      <KeyValue label="Address" value={call.address} mono={true} />
      <KeyValue label="Function" value={call.function} mono={false} />
      <KeyValue label="Args" value={formatInertValue(call.args)} mono={false} />
      <KeyValue label="Then" value={`${call.then.namespace}.${call.then.function} ${formatInertValue(call.then.args)}`} mono={false} />
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

function UiNodeView({
  node,
  state,
  onAction,
  onInput,
}: {
  readonly node: ResolvedUiNode
  readonly state: Record<string, InertValue>
  readonly onAction: (action: ResolvedButtonNode) => Promise<void>
  readonly onInput: (name: string, value: string) => void
}): ReactElement {
  switch (node.element) {
    case "Screen":
    case "Fragment":
      return (
        <>
          {node.children.map((child, index) => (
            <UiNodeView key={index} node={child} state={state} onAction={onAction} onInput={onInput} />
          ))}
        </>
      )
    case "Text":
      return <p className="text-row">{stringProp(node.props, "text")}</p>
    case "TextField": {
      const name = stateKey(node)
      return (
        <label className="field">
          <span>{stringProp(node.props, "label")}</span>
          <input
            // The CAM state key is the field identity. Expose the same name to
            // the DOM so tests, autofill, and agents do not need a parallel
            // mapping from rendered inputs back to protocol state.
            name={name}
            value={stateString(state, name)}
            onChange={(event) => onInput(name, event.currentTarget.value)}
          />
        </label>
      )
    }
    case "Address":
      return <KeyValue label={stringProp(node.props, "label")} value={stringProp(node.props, "address")} mono={true} />
    case "Status":
      return <KeyValue label={stringProp(node.props, "label")} value={formatInertValue(node.props.value)} mono={false} />
    case "Nft":
      return (
        <div className="nft-row">
          <KeyValue label="NFT contract" value={stringProp(node.props, "contractAddress")} mono={true} />
          <KeyValue label="Token ID" value={formatInertValue(node.props.tokenId)} mono={false} />
        </div>
      )
    case "Button":
      return (
        <button
          className="action-button"
          type="button"
          onClick={() => {
            void onAction(node)
          }}
        >
          {stringProp(node.props, "label")}
        </button>
      )
  }

  return unreachableUiNode(node)
}

function unreachableUiNode(_node: never): never {
  throw new Error("unsupported resolved UI node element")
}

function stateKey(node: ResolvedUiNode): string {
  if (node.element !== "TextField" || node.state === undefined) {
    throw new Error("resolved TextField node has no state key")
  }

  return node.state.key
}

function stateString(state: Record<string, InertValue>, name: string): string {
  const value = state[name]
  if (typeof value !== "string") {
    throw new Error(`viewer state field must be a string: ${name}`)
  }

  return value
}

function stringProp(props: Record<string, InertValue>, name: string): string {
  const value = props[name]
  if (typeof value !== "string") {
    throw new Error(`resolved UI prop must be a string: ${name}`)
  }

  return value
}

function KeyValue({
  label,
  value,
  mono,
}: {
  readonly label: string
  readonly value: string
  readonly mono: boolean
}): ReactElement {
  return (
    <div className="key-value">
      <span className="key-label">{label}</span>
      <span className={mono ? "mono" : undefined}>{value}</span>
    </div>
  )
}

function formatInertValue(value: InertValue): string {
  if (value === null) return "null"
  if (typeof value === "string") return value
  if (typeof value === "number" || typeof value === "boolean") return String(value)
  return JSON.stringify(value)
}
