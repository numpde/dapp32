import type { ReactElement } from "react"
import type { ClipboardCopyResult } from "./clipboard.ts"
import type { FailureReport } from "./errors.ts"

export function CopyButton({ label, result, onCopy }: {
  readonly label: string
  readonly result: ClipboardCopyResult
  readonly onCopy: () => Promise<void>
}): ReactElement {
  return <>
    <button className="copy-button" type="button" aria-label={`Copy ${label}`} title={`Copy ${label}`} aria-busy={result === "pending"} onClick={() => { void onCopy() }}>
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        {result === "copied" ? <path d="m5 12 4 4 10-10" /> : <><rect x="8" y="8" width="11" height="12" rx="1.5" /><path d="M16 8V5.5A1.5 1.5 0 0 0 14.5 4h-9A1.5 1.5 0 0 0 4 5.5v11A1.5 1.5 0 0 0 5.5 18H8" /></>}
      </svg>
    </button>
    <span className="visually-hidden" role="status">{result === "copied" ? `${label} copied` : ""}</span>
  </>
}

export function CopyRecovery({ failure, label, value }: { readonly failure: FailureReport | undefined; readonly label: string; readonly value: string }): ReactElement | null {
  return failure === undefined ? null : <span className="copy-recovery" role="alert">{failure.message} <input aria-label={`Full value: ${label}`} readOnly value={value} />{failure.diagnostic === undefined ? null : <span className="feedback-diagnostic">{failure.diagnostic}</span>}</span>
}
