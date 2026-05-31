import type { ReactElement } from "react"

import type { InertValue } from "@cam/protocol"
import type {
  ResolvedScreenAction,
  ResolvedScreenElement,
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

export function ScreenView({
  snapshot,
  onAction,
  onInput,
}: {
  readonly snapshot: CamViewerLoadedSnapshot
  readonly onAction: (action: ResolvedScreenAction) => Promise<void>
  readonly onInput: (name: string, value: string) => void
}): ReactElement {
  return (
    <section className="screen">
      <div className="screen-meta">
        <span>{snapshot.route}</span>
        <span>{snapshot.screenURI}</span>
      </div>
      <div className="elements">
        {snapshot.resolvedScreen.elements.map((element, index) => (
          <ScreenElementView
            key={index}
            element={element}
            onAction={onAction}
            onInput={onInput}
          />
        ))}
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
      <KeyValue label="Contract" value={call.contract} mono={false} />
      <KeyValue label="Address" value={call.address} mono={true} />
      <KeyValue label="Function" value={call.function} mono={false} />
      <KeyValue label="Args" value={formatInertValue(call.args)} mono={false} />
      {call.onSuccess === undefined ? null : <KeyValue label="On success" value={`${call.onSuccess.route} ${formatInertValue(call.onSuccess.params)}`} mono={false} />}
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
            value={element.value}
            onChange={(event) => onInput(element.name, event.currentTarget.value)}
          />
        </label>
      )
    case "address":
      return <KeyValue label={element.label} value={element.address} mono={true} />
    case "status":
      return <KeyValue label={element.label} value={formatInertValue(element.value)} mono={false} />
    case "nft":
      return (
        <div className="nft-row">
          <KeyValue label="NFT contract" value={element.contractAddress} mono={true} />
          <KeyValue label="Token ID" value={formatInertValue(element.tokenId)} mono={false} />
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
