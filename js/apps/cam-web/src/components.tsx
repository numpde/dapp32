import type { ReactElement } from "react"

import type { InertValue } from "@cam/protocol"
import type {
  ResolvedActionNode,
  ResolvedUiNode,
} from "@cam/screen"
import type {
  CamViewerLoadedSnapshot,
  CamViewerPreparedContractCall,
} from "@cam/viewer"

import {
  shortenAddress,
} from "./evm"

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
  readonly onAction: (action: ResolvedActionNode) => Promise<void>
  readonly onInput: (name: string, value: string) => void
}): ReactElement {
  return (
    <section className="ui">
      <div className="ui-meta">
        <span>{snapshot.route}</span>
        <span>{snapshot.uiURI}</span>
      </div>
      <div className="elements">
        <UiNodeView node={snapshot.resolvedUi} onAction={onAction} onInput={onInput} />
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
  onAction,
  onInput,
}: {
  readonly node: ResolvedUiNode
  readonly onAction: (action: ResolvedActionNode) => Promise<void>
  readonly onInput: (name: string, value: string) => void
}): ReactElement {
  switch (node.tag) {
    case "Screen":
    case "Fragment":
      return (
        <>
          {node.children.map((child, index) => (
            <UiNodeView key={index} node={child} onAction={onAction} onInput={onInput} />
          ))}
        </>
      )
    case "Text":
      return <p className="text-row">{stringProp(node.props, "text")}</p>
    case "Input": {
      const name = stringProp(node.props, "name")
      return (
        <label className="field">
          <span>{stringProp(node.props, "label")}</span>
          <input
            value={stringProp(node.props, "value")}
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
    case "Action":
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
  throw new Error("unsupported resolved UI node tag")
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
