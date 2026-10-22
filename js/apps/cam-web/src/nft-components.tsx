import { useCallback, useEffect, useId, useRef, useState } from "react"
import type { ReactElement } from "react"
import { isRecordObject } from "@cam/protocol"
import type { InertRecord } from "@cam/protocol"
import { errorMessage } from "./errors.ts"
import { loadNftImage, loadNftMetadata, nftMetadataDataURI, parseNftMetadata, serializeNftMetadata, NFT_METADATA_MAX_BYTES } from "./nft-metadata.ts"

type Resource<T> = { readonly status: "idle" | "pending" } | { readonly status: "ready"; readonly value: T } | { readonly status: "failed"; readonly message: string }

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
      if (!controller.signal.aborted) setResource({ status: "failed", message: errorMessage(error) })
    }
    return undefined
  }, [])
  return { resource, run, cancel }
}

function ResourceFeedback({ resource }: { readonly resource: Resource<unknown> }): ReactElement | null {
  if (resource.status === "pending") return <p role="status">Loading…</p>
  if (resource.status === "failed") return <p className="field-error" role="alert">{resource.message}</p>
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
      <details><summary>Metadata URI</summary><code className="nft-source">{metadataURI}</code></details>
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

function metadataDraft(text: string): { readonly metadata: InertRecord; readonly json: string; readonly uri: string } | { readonly error: string } {
  try {
    const metadata = parseNftMetadata(text)
    return { metadata, json: serializeNftMetadata(metadata), uri: nftMetadataDataURI(metadata) }
  } catch (error) { return { error: errorMessage(error) } }
}

export function NftMetadataFieldView({ label, name, value, disabled, onInput }: {
  readonly label: string
  readonly name: string
  readonly value: string
  readonly disabled: boolean
  readonly onInput: (name: string, value: string) => void
}): ReactElement {
  const id = useId()
  const [text, setText] = useState("{}")
  const [appliedURI, setAppliedURI] = useState<string | undefined>(undefined)
  const [feedback, setFeedback] = useState("")
  const [baseURI, setBaseURI] = useState<string | undefined>(undefined)
  const loading = useNftResource<string>()
  const draft = metadataDraft(text)
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
    setFeedback("")
  }
  async function copy(content: string): Promise<void> {
    try { await navigator.clipboard.writeText(content); setFeedback("Copied.") }
    catch { setFeedback("Cannot copy to the clipboard. Select and copy the text below.") }
  }
  function download(): void {
    if (disabled || "error" in draft) return
    const url = URL.createObjectURL(new Blob([draft.json], { type: "application/json" }))
    const link = document.createElement("a")
    link.href = url
    link.download = "nft-metadata.json"
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 0)
    setFeedback("JSON download requested. Publish it, then enter its metadata URI above.")
  }
  return <fieldset className="nft-editor" disabled={disabled}>
    <legend>{label}</legend>
    <label className="field"><span>Token metadata URI</span><input name={name} value={value} onChange={event => { setAppliedURI(undefined); onInput(name, event.currentTarget.value) }} /></label>
    <details><summary>Prepare metadata JSON</summary>
      <p className="field-hint">Enter an image URL and metadata, then download the JSON for hosting or use its data URI. Downloading and copying do not publish or mint anything.</p>
      <button className="button-quiet" type="button" disabled={value === "" || loading.resource.status === "pending"} onClick={() => { void loading.run(async signal => serializeNftMetadata(await loadNftMetadata(value, signal))).then(json => { if (json !== undefined) { setBaseURI(value); editDraft(json) } }) }}>Load from current URI</button>
      <ResourceFeedback resource={loading.resource} />
      {(["name", "description", "image"] as const).map(key => <label className="field" key={key}><span>{key === "image" ? "Image URL" : key === "name" ? "Name" : "Description"}</span><input name={`${name}.metadata.${key}`} maxLength={NFT_METADATA_MAX_BYTES} disabled={"error" in draft} value={"error" in draft || typeof draft.metadata[key] !== "string" ? "" : draft.metadata[key] as string}
        onChange={event => { if (!("error" in draft)) editDraft(JSON.stringify({ ...draft.metadata, [key]: event.currentTarget.value }, null, 2)) }} /></label>)}
      <label className="field"><span>Metadata JSON (including attributes and other fields)</span><textarea id={`${id}-json`} name={`${name}.metadata.json`} maxLength={NFT_METADATA_MAX_BYTES} value={text} aria-invalid={"error" in draft} aria-describedby={`${id}-feedback`} onChange={event => editDraft(event.currentTarget.value)} /></label>
      {"error" in draft ? <p className="field-error" role="alert">{draft.error}</p> : <>
        <NftMetadataPreview metadata={draft.metadata} baseURI={baseURI} />
        <div className="nft-actions"><button className="button-quiet" type="button" onClick={() => { void copy(draft.json) }}>Copy JSON</button><button className="button-quiet" type="button" onClick={download}>Download JSON</button></div>
        <details><summary>Data URI</summary><p className="field-hint">This contains the JSON itself. Storing it on chain increases transaction size. Image URLs remain separate references.</p>
          {relativeImage ? <p className="field-error" role="alert">Use an absolute image URL before applying this metadata as a data URI.</p> : null}
          <label className="field"><span>Generated data URI</span><textarea readOnly value={draft.uri} /></label>
          <div className="nft-actions"><button className="button-quiet" type="button" onClick={() => { void copy(draft.uri) }}>Copy data URI</button><button className="button-quiet" type="button" disabled={relativeImage} onClick={() => { setAppliedURI(draft.uri); onInput(name, draft.uri); setFeedback("Data URI selected. Editing this JSON will clear the selected URI until you apply it again.") }}>Use data URI</button></div>
        </details>
      </>}
      <p id={`${id}-feedback`} role="status">{feedback}</p>
    </details>
  </fieldset>
}
