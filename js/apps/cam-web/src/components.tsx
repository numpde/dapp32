import type { ReactElement } from "react"

import type { InertValue } from "@cam/protocol"
import type {
  ResolvedScreenAction,
  ResolvedScreenElement,
} from "@cam/screen"
import type { CamViewerPreparedContractCall } from "@cam/viewer"

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

export function ScreenElementView({
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
