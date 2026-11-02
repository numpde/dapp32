import type { ReactElement } from "react"
import { useClipboardCopy } from "./clipboard.ts"

export function JsonView({ text, label }: {
  readonly text: string
  readonly label: string
}): ReactElement {
  const { result, copy, failure } = useClipboardCopy(text)
  return <div className="json-view">
    <div className="json-controls">
      <button className="button-quiet" type="button" aria-label={`Copy JSON for ${label}`} aria-busy={result === "pending"} onClick={() => { void copy() }}>Copy JSON</button>
      <span role="status">{result === "copied" ? "JSON copied" : ""}</span>
    </div>
    {failure === undefined ? null : <p className="json-copy-error" role="alert">{failure.message}{failure.diagnostic === undefined ? null : <span className="feedback-diagnostic">{failure.diagnostic}</span>}</p>}
    <pre aria-label={label}><code>{text}</code></pre>
  </div>
}
