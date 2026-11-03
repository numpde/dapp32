import { useContext, useEffect, useRef, useState } from "react"
import type { ReactElement } from "react"
import type { CamIntegrityCheck, CamIntegrityWarning } from "@cam/evm-viem"
import { requireHttpURL, resolveIpfsGatewayURL } from "@cam/protocol"
import { DownloadContext } from "./download-context.ts"
import { useClipboardCopy } from "./clipboard.ts"
import { CopyButton, CopyRecovery } from "./copy-button.tsx"
import { FeedbackBox } from "./feedback.tsx"
import { DismissibleDialog } from "./dismissible-dialog.tsx"
import { PropertyRow } from "./property-row.tsx"
import { Feedback } from "./feedback.tsx"
import { failureReport } from "./errors.ts"
import type { FailureReport } from "./errors.ts"

type RefreshIntegrity = (resource: Pick<CamIntegrityCheck, "uri" | "hashSource">, signal: AbortSignal) => Promise<CamIntegrityCheck>

export function Resources({ snapshot, onRefresh }: {
  readonly snapshot: { readonly camURI?: string; readonly uiURI?: string; readonly integrityWarnings: readonly CamIntegrityWarning[] }
  readonly onRefresh?: RefreshIntegrity
}): ReactElement | null {
  const rows = new Map<string, { label: string; uri: string; warning: CamIntegrityWarning | undefined; hashSource: CamIntegrityCheck["hashSource"] }>()
  if (snapshot.camURI !== undefined) rows.set(`contract:${snapshot.camURI}`, { label: "Manifest", uri: snapshot.camURI, warning: undefined, hashSource: "contract" })
  if (snapshot.uiURI !== undefined) rows.set(`manifest:${snapshot.uiURI}`, { label: "UI", uri: snapshot.uiURI, warning: undefined, hashSource: "manifest" })
  for (const warning of snapshot.integrityWarnings) {
    const key = `${warning.hashSource}:${warning.uri}`
    const known = rows.get(key)
    rows.set(key, { label: warning.hashSource === "contract" ? "Manifest" : known === undefined ? "Resource" : known.label, uri: warning.uri, warning, hashSource: warning.hashSource })
  }
  if (rows.size === 0) return null
  return <section className="resources" aria-label="Resources">
    <h2>Resources</h2>
    {[...rows].map(([key, row]) => <ResourceRow key={key} {...row} onRefresh={onRefresh} />)}
  </section>
}

function ResourceRow({ label, uri, warning, hashSource, onRefresh }: {
  readonly label: string; readonly uri: string; readonly warning: CamIntegrityWarning | undefined
  readonly hashSource: CamIntegrityCheck["hashSource"]; readonly onRefresh: RefreshIntegrity | undefined
}): ReactElement {
  const statusLabel = warning === undefined ? hashSource === "contract" ? "Matches contract" : "Matches manifest"
    : warning.status === "mismatch" ? "Hash mismatch" : "Not verified"
  const [showDetails, setShowDetails] = useState(false)
  const downloads = useContext(DownloadContext)
  const { result, copy, failure } = useClipboardCopy(uri)
  let href: string | undefined
  try {
    downloads.assertAllowed(uri)
    href = requireHttpURL(/^ipfs:\/\//i.test(uri) ? resolveIpfsGatewayURL(uri, downloads.gateway) : uri, "Resource URI").href
  } catch { /* Unsupported or disallowed URIs remain available to copy. */ }
  return <div className="resource-row">
    <div className="resource-value">
      {href === undefined ? <span className="resource-link" title={uri}>{label}</span> : <a className="resource-link" href={href} target="_blank" rel="noopener noreferrer" title={uri}>{label} <span aria-hidden="true">↗</span><span className="visually-hidden"> (opens in new tab)</span></a>}
      <CopyButton label={`${label} URI`} result={result} onCopy={copy} />
      <button className={`${warning === undefined ? "resource-status-ok" : "resource-status-warning"} button-quiet`} type="button" aria-haspopup="dialog" aria-label={`${label} verification: ${statusLabel}`} onClick={() => setShowDetails(true)}>{statusLabel}</button>
      <CopyRecovery failure={failure} label={`${label} URI`} value={uri} />
    </div>
    <DismissibleDialog open={showDetails} label={`${label} verification`} onDismiss={() => setShowDetails(false)}>
      {!showDetails ? null : <><h2>{label} verification</h2><IntegrityDetails key={JSON.stringify(warning)} resource={{ uri, hashSource }} initial={warning} onRefresh={onRefresh} /><button type="button" className="button-quiet" onClick={() => setShowDetails(false)}>Close</button></>}
    </DismissibleDialog>
  </div>
}

function IntegrityDetails({ resource, initial, onRefresh }: { readonly resource: Pick<CamIntegrityCheck, "uri" | "hashSource">; readonly initial: CamIntegrityCheck | undefined; readonly onRefresh: RefreshIntegrity | undefined }): ReactElement {
  const [latest, setLatest] = useState<CamIntegrityCheck | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<FailureReport | undefined>(undefined)
  const pending = useRef<AbortController | undefined>(undefined)
  useEffect(() => () => { pending.current?.abort(); pending.current = undefined }, [])
  // silent-defaults: allow-default -- Retain the loaded check until a fresh check completes.
  const checked = latest ?? initial
  const changed = checked !== undefined && initial !== undefined && (checked.uri !== initial.uri || checked.actualHash.toLowerCase() !== initial.actualHash.toLowerCase())
  const hashLocation = resource.hashSource === "contract" ? "stored in the contract" : "specified in the app manifest"
  const message = checked?.status === "verified" ? `The latest download matches the verification hash ${hashLocation}.`
    : checked?.status === "mismatch" ? `This file does not match the verification hash ${hashLocation}.`
    : `This file could not be verified. The verification hash ${hashLocation} is zero.`

  async function refresh(): Promise<void> {
    if (onRefresh === undefined || pending.current !== undefined) return
    const controller = new AbortController()
    pending.current = controller
    setBusy(true)
    setFailure(undefined)
    try {
      const result = await onRefresh(resource, controller.signal)
      if (!controller.signal.aborted) setLatest(result)
    } catch (error) {
      if (!controller.signal.aborted) setFailure(failureReport(error, "Cannot check these hashes. Any displayed hashes have not changed."))
    } finally {
      if (!controller.signal.aborted) setBusy(false)
      if (pending.current === controller) pending.current = undefined
    }
  }

  useEffect(() => {
    if (initial === undefined) void refresh()
  }, [])

  if (checked === undefined && onRefresh === undefined) return <p>Hash checking is unavailable for this resource.</p>
  if (checked === undefined) return failure === undefined ? <p role="status" aria-busy={busy}>Checking current resource hashes…</p> : <><Feedback kind="error" report={failure} /><button type="button" className="button-quiet" onClick={() => { void refresh() }}>Retry checking hashes</button></>

  return <FeedbackBox kind={checked.status === "mismatch" ? "error" : checked.status === "verified" && !changed ? "status" : "warning"} message={message}>
    <div className="integrity-resource">
      {onRefresh === undefined ? null : <button className="button-quiet integrity-refresh" type="button" aria-label="Refresh hashes" title="Refresh hashes" aria-busy={busy} disabled={busy} onClick={() => { void refresh() }}>
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M20 11a8 8 0 1 0-2 6M20 4v7h-7" /></svg>
      </button>}
    </div>
    <PropertyRow label="Expected hash" value={checked.expectedHash} />
    <PropertyRow label="Downloaded hash" value={checked.actualHash} />
    {initial === undefined ? <p>These hashes describe a fresh download. The loaded app has not been reloaded.</p> : null}
    {changed ? <p>The file has changed since it was loaded. Refreshing hashes does not reload the app.</p> : null}
    {failure === undefined ? null : <Feedback kind="error" report={failure} />}
  </FeedbackBox>
}
