import { useState } from "react"
import type { ReactElement, ReactNode } from "react"
import { displayText } from "./display.ts"
import { CopyButton } from "./copy-button.tsx"
import { useClipboardCopy } from "./clipboard.ts"

type HexValueProps = { readonly value: string; readonly label: string; readonly href?: string }

export function HexValue(props: HexValueProps): ReactElement {
  if (!/^(?:(?:sha256:)?0x(?:[0-9a-fA-F]{40}|[0-9a-fA-F]{64})|[0-9a-fA-F]{40})$/.test(props.value)) return <>{displayText(props.value)}</>
  return <CopyableHex key={props.value} {...props} />
}

function CopyableHex({ value, label, href }: HexValueProps): ReactElement {
  const { result, copy, failure } = useClipboardCopy(value)
  const code = <HexText value={value} />
  return <span className="hex-value">
    <span className="hex-value-controls">
      {href === undefined ? code : <a href={href} target="_blank" rel="noopener noreferrer" title={`View ${label}`}>{code}</a>}
      <CopyButton label={label} result={result} onCopy={copy} />
    </span>
    {failure === undefined ? null : <span className="hex-copy-error" role="alert">{failure.message} <input aria-label={`Full value: ${label}`} readOnly value={value} />{failure.diagnostic === undefined ? null : <span className="feedback-diagnostic">{failure.diagnostic}</span>}</span>}
  </span>
}

function hexParts(value: string) {
  const prefix = value.startsWith("sha256:") ? "sha256:" : ""
  const hex = value.slice(prefix.length)
  const revision = /^[0-9a-fA-F]{40}$/.test(value)
  return revision
    ? { start: hex.slice(0, 8), middle: hex.slice(8), end: "", revision }
    : { start: prefix + hex.slice(0, 6), middle: hex.slice(6, -4), end: hex.slice(-4), revision }
}

export function HexText({ value }: { readonly value: string }): ReactElement {
  const parts = hexParts(value)
  return <code title={value}><span>{parts.start}</span><span className={parts.revision ? "visually-hidden" : "hex-middle"}>{parts.middle}{parts.revision ? null : <span className="hex-ellipsis" aria-hidden="true" />}</span><span>{parts.end}</span></code>
}

export function CompactHexEntry({ value, compact, children, className }: {
  readonly value: string
  readonly compact: boolean
  readonly children: ReactNode
  readonly className?: string
}): ReactElement {
  const [editing, setEditing] = useState(false)
  const shortened = compact && !editing
  return <div className={className === undefined ? "compact-hex-entry" : `compact-hex-entry ${className}`} data-compact={shortened}
    onFocus={() => setEditing(true)} onBlur={() => setEditing(false)}>
    {children}
    {shortened ? <span className="compact-hex-display" aria-hidden="true"><HexText value={value} /></span> : null}
  </div>
}
