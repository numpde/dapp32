import { useEffect, useRef, useState } from "react"
import type { ReactElement } from "react"
import { displayText } from "./display.ts"
import { failureReport, UserFacingError } from "./errors.ts"
import type { FailureReport } from "./errors.ts"

type HexValueProps = { readonly value: string; readonly label: string; readonly href?: string }

export function HexValue(props: HexValueProps): ReactElement {
  if (!/^(?:sha256:)?0x(?:[0-9a-fA-F]{40}|[0-9a-fA-F]{64})$/.test(props.value)) return <>{displayText(props.value)}</>
  return <CopyableHex key={props.value} {...props} />
}

function CopyableHex({ value, label, href }: HexValueProps): ReactElement {
  const attempt = useRef(0)
  const [result, setResult] = useState<"idle" | "pending" | "copied" | FailureReport>("idle")
  useEffect(() => () => { attempt.current++ }, [])

  async function copy(): Promise<void> {
    const current = ++attempt.current
    setResult("pending")
    try {
      if (navigator.clipboard === undefined) throw new UserFacingError("Clipboard access is unavailable in this browser.")
      await navigator.clipboard.writeText(value)
      if (attempt.current === current) setResult("copied")
    } catch (cause) {
      if (attempt.current === current) setResult(failureReport(cause, "Cannot copy this value. Select and copy the full value below."))
    }
  }

  const prefix = value.startsWith("sha256:") ? "sha256:" : ""
  const hex = value.slice(prefix.length)
  const short = `${prefix}${hex.slice(0, 6)}...${hex.slice(-4)}`
  const failure = typeof result === "object" ? result : undefined
  const code = <code title={value}><span className="hex-short" aria-hidden="true">{short}</span><span className="visually-hidden">{value}</span></code>
  return <span className="hex-value">
    <span className="hex-value-controls">
      {href === undefined ? code : <a href={href} target="_blank" rel="noopener noreferrer" title={`View ${label}`}>{code}</a>}
      <button className="hex-copy" type="button" aria-label={`Copy ${label}`} title={`Copy ${label}`} aria-busy={result === "pending"} onClick={() => { void copy() }}>
        {result === "copied" ? <span aria-hidden="true">✓</span> : <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><rect x="8" y="8" width="11" height="12" rx="1.5" /><path d="M16 8V5.5A1.5 1.5 0 0 0 14.5 4h-9A1.5 1.5 0 0 0 4 5.5v11A1.5 1.5 0 0 0 5.5 18H8" /></svg>}
      </button>
      <span className="visually-hidden" role="status">{result === "copied" ? `${label} copied` : ""}</span>
    </span>
    {failure === undefined ? null : <span className="hex-copy-error" role="alert">{failure.message} <code>{value}</code>{failure.diagnostic === undefined ? null : <span className="feedback-diagnostic">{failure.diagnostic}</span>}</span>}
  </span>
}
