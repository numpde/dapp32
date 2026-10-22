import { useCallback, useEffect, useId, useRef, useState } from "react"
import type { ReactElement } from "react"
import { isRecordObject } from "@cam/protocol"
import type { InertRecord } from "@cam/protocol"
import { failureReport } from "./errors.ts"
import type { FailureReport } from "./errors.ts"
import { Feedback } from "./feedback.tsx"
import { loadNftImage, loadNftMetadata, nftMetadataDataURI, parseNftMetadata, serializeNftMetadata, NFT_METADATA_MAX_BYTES } from "./nft-metadata.ts"

type Resource<T> = { readonly status: "idle" | "pending" } | { readonly status: "ready"; readonly value: T } | { readonly status: "failed"; readonly error: unknown }

function useNftResource<T>() {
  const [resource, setResource] = useState<Resource<T>>({ status: "idle" })
  const pending = useRef<AbortController | undefined>(undefined)
  useEffect(() => () => pending.current?.abort(), [])
  function cancel(): void {
    pending.current?.abort()
    setResource({ status: "idle" })
  }
  const run = useCallback(async (acquire: (signal: AbortSignal) => Promise<T>): Promise<T | undefined> => {
    pending.current?.abort()
    const controller = new AbortController()
    pending.current = controller
    setResource({ status: "pending" })
    try {
      const value = await acquire(controller.signal)
      if (controller.signal.aborted) return undefined
      setResource({ status: "ready", value })
      return value
    } catch (error) {
      if (!controller.signal.aborted) setResource({ status: "failed", error })
    }
    return undefined
  }, [])
  return { resource, run, cancel }
}

function ResourceFeedback({ resource }: { readonly resource: Resource<unknown> }): ReactElement | null {
  if (resource.status === "pending") return <p role="status">Loading…</p>
  if (resource.status === "failed") return <Feedback report={failureReport(resource.error)} kind="error" />
  return null
}

export function NftView({ contractAddress, tokenId, metadataURI }: {
  readonly contractAddress: string
  readonly tokenId: string
  readonly metadataURI: string | undefined
}): ReactElement {
  const preview = useNftResource<InertRecord>()
  return <div className="nft-row">
    <dl className="nft-identity"><div><dt>NFT contract</dt><dd>{contractAddress}</dd></div><div><dt>Token ID</dt><dd>{tokenId}</dd></div></dl>
    {metadataURI !== undefined && metadataURI !== "" ? <>
      <label className="field"><span>Metadata URI</span><input readOnly value={metadataURI} /></label>
      <div className="nft-actions"><button className="button-quiet" type="button" disabled={preview.resource.status === "pending"} onClick={() => { void preview.run(signal => loadNftMetadata(metadataURI, signal)) }}>Load metadata</button>
        {preview.resource.status === "pending" ? <button className="button-quiet" type="button" onClick={preview.cancel}>Cancel loading</button> : null}</div>
      <ResourceFeedback resource={preview.resource} />
      {preview.resource.status === "ready" ? <NftMetadataPreview metadata={preview.resource.value} baseURI={metadataURI} /> : null}
    </> : null}
  </div>
}

export function NftMetadataPreview({ metadata, baseURI }: { readonly metadata: InertRecord; readonly baseURI: string | undefined }): ReactElement {
  const attributes = Array.isArray(metadata.attributes) ? metadata.attributes : []
  return <section className="nft-preview" aria-label="Metadata preview">
    {typeof metadata.name === "string" && metadata.name !== "" ? <h3>{metadata.name}</h3> : null}
    {typeof metadata.description === "string" && metadata.description !== "" ? <p>{metadata.description}</p> : null}
    {typeof metadata.image === "string" && metadata.image !== "" ? <NftImage key={JSON.stringify([baseURI, metadata.image])} uri={metadata.image} baseURI={baseURI} alt={typeof metadata.name === "string" ? metadata.name : "NFT image"} /> : null}
    <dl className="nft-attributes">{attributes.map((attribute, index) => isRecordObject(attribute) && typeof attribute.trait_type === "string" && (typeof attribute.value === "string" || typeof attribute.value === "number" || typeof attribute.value === "boolean")
      ? <div key={index}><dt>{attribute.trait_type}</dt><dd>{String(attribute.value)}</dd></div> : null)}</dl>
  </section>
}

function NftImage({ uri, baseURI, alt }: { readonly uri: string; readonly baseURI: string | undefined; readonly alt: string }): ReactElement {
  const image = useNftResource<Blob>()
  const [source, setSource] = useState<{ readonly blob: Blob; readonly url: string } | undefined>(undefined)
  const [decodeFailed, setDecodeFailed] = useState(false)
  const embedded = uri.startsWith("data:")
  useEffect(() => {
    if (embedded) void image.run(signal => loadNftImage(uri, baseURI, signal))
  }, [embedded, uri, baseURI, image.run])
  useEffect(() => {
    if (image.resource.status !== "ready") return
    const blob = image.resource.value
    const url = URL.createObjectURL(blob)
    setSource({ blob, url })
    return () => URL.revokeObjectURL(url)
  }, [image.resource])
  return <div className="nft-image">
    <p className="field-hint">Image source: <code className="nft-source">{uri}</code></p>
    {!embedded ? <div className="nft-actions"><button className="button-quiet" type="button" disabled={image.resource.status === "pending"} onClick={() => { setDecodeFailed(false); void image.run(signal => loadNftImage(uri, baseURI, signal)) }}>Load image</button>
      {image.resource.status === "pending" ? <button className="button-quiet" type="button" onClick={image.cancel}>Cancel loading</button> : null}</div> : null}
    <ResourceFeedback resource={image.resource} />
    {image.resource.status === "ready" && source?.blob === image.resource.value && !decodeFailed ? <img src={source.url} alt={alt || "NFT image"} onError={() => setDecodeFailed(true)} /> : null}
    {decodeFailed ? <p className="field-error" role="alert">Cannot display these image bytes. Use a valid PNG, JPEG, WebP or GIF image.</p> : null}
  </div>
}

function metadataDraft(text: string): { readonly metadata: InertRecord; readonly json: string; readonly uri: string } | { readonly error: unknown } {
  try {
    const metadata = parseNftMetadata(text)
    return { metadata, json: serializeNftMetadata(metadata), uri: nftMetadataDataURI(metadata) }
  } catch (error) { return { error } }
}

export function NftMetadataFieldView({ label, name, value, disabled, onInput }: {
  readonly label: string
  readonly name: string
  readonly value: string
  readonly disabled: boolean
  readonly onInput: (name: string, value: string) => void
}): ReactElement {
  const id = useId()
  const embeddedSelection = /^data:/i.test(value)
  const [mode, setMode] = useState<"hosted" | "embedded">(embeddedSelection ? "embedded" : "hosted")
  const [hostedURI, setHostedURI] = useState(embeddedSelection ? "" : value)
  const tabs = useRef<(HTMLButtonElement | null)[]>([])
  const [text, setText] = useState("{}")
  const [appliedURI, setAppliedURI] = useState<string | undefined>(undefined)
  const [feedback, setFeedback] = useState<{ readonly kind: "error" | "status"; readonly report: FailureReport } | undefined>(undefined)
  const [baseURI, setBaseURI] = useState<string | undefined>(undefined)
  const loading = useNftResource<string>()
  const draft = metadataDraft(text)
  const hostedIsEmbedded = /^data:/i.test(hostedURI)
  const relativeImage = !("error" in draft) && typeof draft.metadata.image === "string" && draft.metadata.image !== "" && !/^[A-Za-z][A-Za-z0-9+.-]*:/.test(draft.metadata.image)
  useEffect(() => { loading.cancel() }, [value, disabled])
  function editDraft(next: string): void {
    if (disabled) return
    loading.cancel()
    if (next !== text && appliedURI !== undefined && value === appliedURI) {
      onInput(name, "")
      setAppliedURI(undefined)
    }
    setText(next)
    setFeedback(undefined)
  }
  async function copy(content: string): Promise<void> {
    setFeedback(undefined)
    try { await navigator.clipboard.writeText(content); setFeedback({ kind: "status", report: { message: "Copied." } }) }
    catch (error) { setFeedback({ kind: "error", report: failureReport(error, "Cannot copy to the clipboard. Select and copy the text below.") }) }
  }
  function download(): void {
    if (disabled || "error" in draft) return
    const url = URL.createObjectURL(new Blob([draft.json], { type: "application/json" }))
    const link = document.createElement("a")
    link.href = url
    link.download = "nft-metadata.json"
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 0)
    setFeedback({ kind: "status", report: { message: "JSON download requested. Host the file, then enter its URI in Hosted JSON." } })
  }
  const editor = <>
      <button className="button-quiet" type="button" disabled={value === "" || loading.resource.status === "pending"} onClick={() => { void loading.run(async signal => serializeNftMetadata(await loadNftMetadata(value, signal))).then(json => { if (json !== undefined) { setBaseURI(value); editDraft(json) } }) }}>Load selected metadata</button>
      <ResourceFeedback resource={loading.resource} />
      {(["name", "description", "image"] as const).map(key => <label className="field" key={key}><span>{key === "image" ? "Image URL" : key === "name" ? "Name" : "Description"}</span><input name={`${name}.metadata.${key}`} maxLength={NFT_METADATA_MAX_BYTES} disabled={"error" in draft} value={"error" in draft || typeof draft.metadata[key] !== "string" ? "" : draft.metadata[key] as string}
        onChange={event => { if (!("error" in draft)) editDraft(JSON.stringify({ ...draft.metadata, [key]: event.currentTarget.value }, null, 2)) }} /></label>)}
      <label className="field"><span>Metadata JSON (including attributes and other fields)</span><textarea id={`${id}-json`} name={`${name}.metadata.json`} maxLength={NFT_METADATA_MAX_BYTES} value={text} aria-invalid={"error" in draft} aria-describedby={`${id}-feedback`} onChange={event => editDraft(event.currentTarget.value)} /></label>
      {"error" in draft ? <ResourceFeedback resource={{ status: "failed", error: draft.error }} /> : <>
        <NftMetadataPreview metadata={draft.metadata} baseURI={baseURI} />
        <div className="nft-actions"><button className="button-quiet" type="button" onClick={() => { void copy(draft.json) }}>Copy JSON</button><button className="button-quiet" type="button" onClick={download}>Download JSON</button></div>
      </>}
  </>
  return <fieldset className="nft-editor" disabled={disabled}>
    <legend>{label}</legend>
    <p className="nft-selection" role="status">{value === "" ? "No metadata selected for submission." : embeddedSelection ? "Selected for submission: embedded URI." : "Selected for submission: hosted URI."}</p>
    <p className="field-hint">Choose “Use…” to select a draft for the transaction. Editing an applied draft clears that choice; switching tabs preserves it. Send the transaction separately.</p>
    <div className="nft-tabs" role="tablist" aria-label={`${label} source`}>
      {(["hosted", "embedded"] as const).map((tab, index) => <button key={tab} ref={node => { tabs.current[index] = node }} id={`${id}-${tab}-tab`} type="button" role="tab" aria-selected={mode === tab} aria-controls={`${id}-${tab}-panel`} tabIndex={mode === tab ? 0 : -1} onClick={() => setMode(tab)} onKeyDown={event => {
        let next: number
        if (event.key === "ArrowLeft" || event.key === "ArrowRight") next = 1 - index
        else if (event.key === "Home") next = 0
        else if (event.key === "End") next = 1
        else return
        event.preventDefault()
        setMode(next === 0 ? "hosted" : "embedded")
        tabs.current[next]?.focus()
      }}>{tab === "hosted" ? "Hosted JSON" : "Embed JSON"}</button>)}
    </div>
    <section id={`${id}-hosted-panel`} role="tabpanel" aria-labelledby={`${id}-hosted-tab`} hidden={mode !== "hosted"} tabIndex={0}>
      {mode === "hosted" ? <>
        <p className="field-hint">Host the JSON document and enter its location. You can prepare and download the file below.</p>
        <label className="field"><span>Hosted metadata URI</span><input name={name} value={hostedURI} aria-invalid={hostedIsEmbedded} aria-describedby={hostedIsEmbedded ? `${id}-hosted-error` : undefined} onChange={event => { if (value === hostedURI && event.currentTarget.value !== hostedURI) onInput(name, ""); setHostedURI(event.currentTarget.value); setFeedback(undefined) }} /></label>
        {hostedIsEmbedded ? <p id={`${id}-hosted-error`} className="field-error" role="alert">This URI contains the document itself. Choose Embed JSON to prepare an embedded document, or enter the location of a hosted JSON file.</p> : null}
        <button className="button-quiet" type="button" disabled={hostedURI === "" || hostedIsEmbedded} onClick={() => { setAppliedURI(undefined); onInput(name, hostedURI); setFeedback(undefined) }}>Use hosted JSON</button>
        <details className="nft-hosted-draft"><summary>Prepare JSON for hosting</summary>{editor}</details>
      </> : null}
    </section>
    <section id={`${id}-embedded-panel`} role="tabpanel" aria-labelledby={`${id}-embedded-tab`} hidden={mode !== "embedded"} tabIndex={0}>
      {mode === "embedded" ? <>
        <p className="field-hint">Store the JSON itself on chain instead of hosting a JSON file. This increases transaction size; external image URLs remain separate.</p>
        {editor}
        {relativeImage ? <p className="field-error" role="alert">Use an absolute image URL before embedding this JSON.</p> : null}
        <button className="button-quiet" type="button" disabled={relativeImage || "error" in draft} onClick={() => { if (!("error" in draft)) { setAppliedURI(draft.uri); onInput(name, draft.uri); setFeedback(undefined) } }}>Use embedded JSON</button>
      </> : null}
    </section>
    {value !== "" ? <details><summary>URI to submit</summary><label className="field"><span>Selected URI</span><textarea readOnly value={value} /></label><button className="button-quiet" type="button" onClick={() => { void copy(value) }}>Copy URI</button></details> : null}
      <div id={`${id}-feedback`}>{feedback === undefined ? null : <Feedback report={feedback.report} kind={feedback.kind} className={feedback.kind === "error" ? "field-error" : "field-hint"} />}</div>
  </fieldset>
}
