import { useContext, useId, useMemo, useState } from "react"
import type { ReactElement } from "react"
import { requireHttpURL, resolveIpfsGatewayURL } from "@cam/protocol"
import { useClipboardCopy } from "./clipboard.ts"
import { CopyButton } from "./copy-button.tsx"
import { readTextDataURI, textDataURI } from "./data-uri.ts"
import { DownloadContext } from "./download-context.ts"
import { DismissibleDialog } from "./dismissible-dialog.tsx"
import { displayText } from "./display.ts"
import { failureReport, UserFacingError } from "./errors.ts"
import { Feedback } from "./feedback.tsx"
import { JsonView } from "./json-view.tsx"
import { PropertyRow } from "./property-row.tsx"

const DOCUMENT_LIMIT = 256 * 1024

export function UriFieldView({ label, name, value, scope, maxBytes, disabled, onInput }: {
  readonly label: string
  readonly name: string
  readonly value: string
  readonly scope: string
  readonly maxBytes?: string
  readonly disabled: boolean
  readonly onInput: (name: string, value: string | null) => void
}): ReactElement {
  const inputId = useId()
  const documentId = useId()
  const capacityId = useId()
  const embedded = /^data:/i.test(value)
  const actionLabel = `${embedded ? "Edit embedded document for" : "Embed document for"} ${label}`
  const [draft, setDraft] = useState<{ original: string; scope: string; initial: string; initialType: "text/plain" | "application/json" | undefined; text: string; type: "text/plain" | "application/json" }>()
  const [error, setError] = useState<unknown>()
  const candidate = useMemo(() => {
    if (draft === undefined) return undefined
    if (draft.text === draft.initial && draft.type === draft.initialType) return { kind: "ready" as const, uri: draft.original }
    try { return { kind: "ready" as const, uri: textDataURI(draft.text, draft.type, DOCUMENT_LIMIT) } }
    catch (cause) { return { kind: "failed" as const, error: cause } }
  }, [draft])
  const uriBytes = candidate?.kind === "ready" ? new TextEncoder().encode(candidate.uri).byteLength : undefined
  const overLimit = uriBytes !== undefined && maxBytes !== undefined && BigInt(uriBytes) > BigInt(maxBytes)
  const capacityLabel = uriBytes === undefined ? "Encoded URI size unavailable until the document is valid"
    : maxBytes === undefined ? `Encoded URI: ${uriBytes} bytes`
      : `Encoded URI: ${uriBytes} of ${maxBytes} bytes${overLimit ? ", over limit" : ""}`
  function dismiss(): void { setDraft(undefined); setError(undefined) }

  function open(): void {
    try {
      const content = /^data:/i.test(value) ? readTextDataURI(value, DOCUMENT_LIMIT) : { text: "", type: "text/plain" as const }
      setError(undefined)
      setDraft({ original: value, scope, initial: content.text, initialType: /^data:/i.test(value) ? content.type : undefined, text: content.text, type: content.type })
    } catch (cause) { setError(cause) }
  }
  function apply(): void {
    if (draft === undefined) return
    try {
      if (disabled || value !== draft.original || scope !== draft.scope) throw new UserFacingError("Cannot apply this document: the view or URI changed while it was being edited. Copy the draft or cancel and reopen the editor.")
      if (candidate === undefined) throw new Error("Cannot apply a document without an active draft.")
      if (candidate.kind === "failed") throw candidate.error
      const next = candidate.uri
      if (maxBytes !== undefined && BigInt(new TextEncoder().encode(next).byteLength) > BigInt(maxBytes)) throw new UserFacingError(`Cannot embed this document: the URI exceeds the ${maxBytes}-byte limit.`)
      onInput(name, next)
      setDraft(undefined)
      setError(undefined)
    } catch (cause) { setError(cause) }
  }
  return <div className="uri-field">
    <label htmlFor={inputId}>{displayText(label)}</label>
    <div className="uri-control">
      <input id={inputId} name={name} value={value} disabled={disabled} onChange={event => onInput(name, event.currentTarget.value)} />
      <button type="button" aria-haspopup="dialog" aria-label={actionLabel} title={actionLabel} disabled={disabled} onClick={open}>
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d="M13 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h7M13 3l5 5h-5z" />
          {embedded ? <path d="m15 18 5-5 2 2-5 5-3 1z" /> : <path d="M18 13v8m-4-4h8" />}
        </svg>
      </button>
    </div>
    {draft === undefined && error !== undefined ? <Feedback report={failureReport(error)} kind="error" /> : null}
    <DismissibleDialog open={draft !== undefined} label={`Embed ${label}`} onDismiss={dismiss}>
      {draft === undefined ? null : <>
        <h2>Embed document</h2>
        <label className="field"><span className="visually-hidden">Content type</span><select value={draft.type} onChange={event => setDraft({ ...draft, type: event.currentTarget.value as typeof draft.type })}><option value="text/plain">Plain text</option><option value="application/json">JSON</option></select></label>
        <div className="field uri-document">
          <label className="visually-hidden" htmlFor={documentId}>Document</label>
          <div className="uri-document-control">
            <textarea id={documentId} aria-describedby={capacityId} value={draft.text} maxLength={DOCUMENT_LIMIT} onChange={event => { setDraft({ ...draft, text: event.currentTarget.value }); setError(undefined) }} />
            <output id={capacityId} htmlFor={documentId} aria-live="off" className="uri-capacity" data-over-limit={overLimit} aria-label={capacityLabel} title={capacityLabel}>{uriBytes === undefined ? "—" : uriBytes}{maxBytes === undefined ? " bytes" : ` / ${maxBytes}`}{overLimit ? " !" : null}</output>
          </div>
        </div>
        {error === undefined ? null : <Feedback report={failureReport(error)} kind="error" />}
        <div className="uri-dialog-actions"><button type="button" onClick={apply}>Use document</button><button type="button" className="button-quiet" onClick={dismiss}>Cancel</button></div>
      </>}
    </DismissibleDialog>
  </div>
}

export function UriValueView({ label, value }: { readonly label: string; readonly value: string }): ReactElement {
  const previewId = useId()
  const downloads = useContext(DownloadContext)
  const { result, copy, failure } = useClipboardCopy(value)
  const [preview, setPreview] = useState<{ readonly text: string; readonly type: "text/plain" | "application/json" }>()
  const [error, setError] = useState<unknown>()
  function open(): void {
    try {
      downloads.assertAllowed(value)
      const destination = /^ipfs:\/\//i.test(value) ? resolveIpfsGatewayURL(value, downloads.gateway) : value
      const url = requireHttpURL(destination, "Document URI")
      window.open(url.href, "_blank", "noopener,noreferrer")
      setError(undefined)
    } catch { setError(new UserFacingError("Cannot open this URI. Check its address and the selected download scope.")) }
  }
  function view(): void {
    try { setPreview(readTextDataURI(value, DOCUMENT_LIMIT)); setError(undefined) }
    catch (cause) { setError(cause) }
  }
  const embedded = /^data:/i.test(value)
  return <PropertyRow label={label} value={<div className="uri-value">
    {embedded ? <details><summary>Embedded document URI</summary><code>{value}</code></details> : <span>{displayText(value)}</span>}
    {value === "" ? null : <>
      <CopyButton label={label} result={result} onCopy={copy} />
      {embedded ? <button type="button" className="button-quiet" aria-expanded={preview !== undefined} aria-controls={preview === undefined ? undefined : previewId} onClick={preview === undefined ? view : () => setPreview(undefined)}>{preview === undefined ? "View" : "Close document"}</button>
        : /^(?:https?:|ipfs:)/i.test(value) ? <button type="button" className="button-quiet" onClick={open}>Open</button> : null}
    </>}
    {preview === undefined ? null : <div className="uri-preview" id={previewId}>{preview.type === "application/json" ? <JsonView text={preview.text} label={label} /> : <pre>{preview.text}</pre>}</div>}
    {failure === undefined ? null : <span className="hex-copy-error" role="alert">{failure.message} <input aria-label={`Full value: ${label}`} readOnly value={value} />{failure.diagnostic === undefined ? null : <span className="feedback-diagnostic">{failure.diagnostic}</span>}</span>}
    {error === undefined ? null : <Feedback report={failureReport(error)} kind="error" />}
  </div>} />
}
