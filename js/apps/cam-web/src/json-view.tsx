import type { ReactElement } from "react"
import { CopyButton } from "./copy-button.tsx"
import { useClipboardCopy } from "./clipboard.ts"

export function JsonView({ text, label }: {
  readonly text: string
  readonly label: string
}): ReactElement {
  const { result, copy, failure } = useClipboardCopy(text)
  return <div className="json-view">
    <pre aria-label={label}><code>{text}</code></pre>
    <CopyButton label={`JSON for ${label}`} result={result} onCopy={copy} />
    {failure === undefined ? null : <p className="json-copy-error" role="alert">{failure.message}{failure.diagnostic === undefined ? null : <span className="feedback-diagnostic">{failure.diagnostic}</span>}</p>}
  </div>
}
