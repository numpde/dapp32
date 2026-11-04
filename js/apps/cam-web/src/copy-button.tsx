import type { ReactElement } from "react"
import { Icon } from "./icon.tsx"
import type { ClipboardCopyResult } from "./clipboard.ts"
import type { FailureReport } from "./errors.ts"

export function CopyButton({ label, result, onCopy }: {
  readonly label: string
  readonly result: ClipboardCopyResult
  readonly onCopy: () => Promise<void>
}): ReactElement {
  return <>
    <button className="copy-button" type="button" aria-label={`Copy ${label}`} title={`Copy ${label}`} aria-busy={result === "pending"} onClick={() => { void onCopy() }}>
      <Icon name={result === "copied" ? "check" : "copy"} />
    </button>
    <span className="visually-hidden" role="status">{result === "copied" ? `${label} copied` : ""}</span>
  </>
}

export function CopyRecovery({ failure, label, value }: { readonly failure: FailureReport | undefined; readonly label: string; readonly value: string }): ReactElement | null {
  return failure === undefined ? null : <span className="copy-recovery" role="alert">{failure.message} <input aria-label={`Full value: ${label}`} readOnly value={value} />{failure.diagnostic === undefined ? null : <span className="feedback-diagnostic">{failure.diagnostic}</span>}</span>
}
