import type { ReactElement, Ref } from "react"

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
import {
  displayText,
  formatInertValue,
} from "./display.ts"
import {
  preparedCallFields,
} from "./prepared-call.ts"

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
  viewRef,
  changingView,
  sending,
  onBack,
  onAction,
  onInput,
}: {
  readonly snapshot: CamViewerLoadedSnapshot
  readonly viewRef: Ref<HTMLElement>
  readonly changingView: boolean
  readonly sending: boolean
  readonly onBack: () => Promise<void>
  readonly onAction: (action: ResolvedButtonNode) => Promise<void>
  readonly onInput: (name: string, value: string) => void
}): ReactElement {
  return (
    <section className="ui" ref={viewRef} tabIndex={-1} aria-label="Current view">
      <div className="ui-meta">
        <button type="button" disabled={changingView || sending || !snapshot.canGoBack} onClick={() => { void onBack() }}>
          Back
        </button>
        <span>{snapshot.route}</span>
        <span>{snapshot.uiURI}</span>
      </div>
      <fieldset className="elements" disabled={changingView || sending} aria-label="Current view" style={{ border: 0, margin: 0, padding: 0, minWidth: 0 }}>
        <UiNodeView node={snapshot.resolvedUi} state={snapshot.state} onAction={onAction} onInput={onInput} />
      </fieldset>
    </section>
  )
}

export function PreparedCallView({
  call,
  reviewRef,
  canSend,
  canDiscard,
  sending,
  onSend,
  onDiscard,
}: {
  readonly call: CamViewerPreparedContractCall
  readonly reviewRef: Ref<HTMLElement>
  readonly canSend: boolean
  readonly canDiscard: boolean
  readonly sending: boolean
  readonly onSend: (call: CamViewerPreparedContractCall) => Promise<void>
  readonly onDiscard: () => void
}): ReactElement {
  return (
    <section className="panel prepared-call" ref={reviewRef} tabIndex={-1} aria-labelledby="prepared-call-title">
      <h2 id="prepared-call-title">Prepared contract call</h2>
      {preparedCallFields(call).map((field) => (
        <KeyValue key={field.label} label={field.label} value={field.value} mono={field.mono} />
      ))}
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
      <button type="button" disabled={!canDiscard} onClick={onDiscard}>
        Discard prepared call
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
      return <p className="text-row">{displayText(stringProp(node.props, "text"))}</p>
    case "TextField": {
      const name = stateKey(node)
      return (
        <label className="field">
          <span>{displayText(stringProp(node.props, "label"))}</span>
          <input
            // The CAM state key is the field identity. Expose the same name to
            // the DOM so tests, autofill, and agents do not need a parallel
            // mapping from rendered inputs back to protocol state.
            name={name}
            disabled={node.disabled === true}
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
          disabled={node.disabled === true}
          onClick={() => {
            void onAction(node)
          }}
        >
          {displayText(stringProp(node.props, "label"))}
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
      <span className="key-label">{displayText(label)}</span>
      <span className={mono ? "mono" : undefined}>{displayText(value)}</span>
    </div>
  )
}
