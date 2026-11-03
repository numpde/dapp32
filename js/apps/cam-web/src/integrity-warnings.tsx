import { useContext, useEffect, useRef, useState } from "react"
import type { ReactElement } from "react"
import type { CamViewerLoadedSnapshot } from "@cam/viewer"
import type { CamIntegrityCheck, CamIntegrityWarning } from "@cam/evm-viem"
import { requireHttpURL, resolveIpfsGatewayURL } from "@cam/protocol"
import { DownloadContext } from "./download-context.ts"
import { useClipboardCopy } from "./clipboard.ts"
import { CopyButton, CopyRecovery } from "./copy-button.tsx"
import { viewerErrorMessage } from "@cam/viewer"
import { FeedbackBox } from "./feedback.tsx"
import { PropertyRow } from "./property-row.tsx"
import { Feedback } from "./feedback.tsx"
import { failureReport } from "./errors.ts"
import type { FailureReport } from "./errors.ts"

type RefreshIntegrity = (warning: CamIntegrityWarning, signal: AbortSignal) => Promise<CamIntegrityCheck>

export function Resources({ snapshot, onRefresh }: { readonly snapshot: CamViewerLoadedSnapshot; readonly onRefresh?: RefreshIntegrity }): ReactElement {
  const manifestWarning = snapshot.integrityWarnings.find(warning => warning.hashSource === "contract")
  const uiWarning = snapshot.integrityWarnings.find(warning => warning.hashSource === "manifest" && warning.uri === snapshot.uiURI)
  const otherWarnings = snapshot.integrityWarnings.filter(warning => warning !== manifestWarning && warning !== uiWarning)
  return <section className="resources" aria-label="Resources">
    <h2>Resources</h2>
    <ResourceRow label="Manifest" uri={snapshot.camURI} warning={manifestWarning} success="Matches contract" onRefresh={onRefresh} />
    <ResourceRow label="UI" uri={snapshot.uiURI} warning={uiWarning} success="Matches manifest" onRefresh={onRefresh} />
    <IntegrityWarnings warnings={otherWarnings} onRefresh={onRefresh} />
  </section>
}

function ResourceRow({ label, uri, warning, success, onRefresh }: {
  readonly label: string; readonly uri: string; readonly warning: CamIntegrityWarning | undefined
  readonly success: string; readonly onRefresh: RefreshIntegrity | undefined
}): ReactElement {
  const downloads = useContext(DownloadContext)
  const { result, copy, failure } = useClipboardCopy(uri)
  let href: string | undefined
  try {
    downloads.assertAllowed(uri)
    href = requireHttpURL(/^ipfs:\/\//i.test(uri) ? resolveIpfsGatewayURL(uri, downloads.gateway) : uri, "Resource URI").href
  } catch { /* Unsupported or disallowed URIs remain available to copy. */ }
  const originEnd = uri.indexOf("/", uri.indexOf("://") + 3)
  const fileStart = uri.lastIndexOf("/")
  const shortened = uri.includes("://") && originEnd >= 0 && fileStart > originEnd
  const linkText = shortened ? <><span className="resource-origin">{uri.slice(0, originEnd)}</span><span className="hex-middle">{uri.slice(originEnd, fileStart)}<span className="hex-ellipsis" aria-hidden="true" /></span><span className="resource-filename">{uri.slice(fileStart)}</span></> : uri
  return <div className="resource-row">
    <PropertyRow label={label} value={<div className="resource-value">
      {href === undefined ? <span className="resource-link" title={uri}>{linkText}</span> : <a className="resource-link" href={href} target="_blank" rel="noopener noreferrer" title={uri}>{linkText}</a>}
      <CopyButton label={`${label} URI`} result={result} onCopy={copy} />
      <span className={warning === undefined ? "resource-status-ok" : "resource-status-warning"}>{warning === undefined ? success : warning.status === "mismatch" ? "Hash mismatch" : "Not verified"}</span>
      <CopyRecovery failure={failure} label={`${label} URI`} value={uri} />
    </div>} />
    {warning === undefined ? null : <details className="resource-details"><summary>Verification details</summary><IntegrityWarning warning={warning} onRefresh={onRefresh} showURI={false} /></details>}
  </div>
}

export function IntegrityWarnings({ warnings, onRefresh }: {
  readonly warnings: CamViewerLoadedSnapshot["integrityWarnings"]
  readonly onRefresh?: RefreshIntegrity | undefined
}): ReactElement | null {
  if (warnings.length === 0) return null
  return <section aria-label="UI integrity warnings">
    {warnings.map(warning => <IntegrityWarning key={JSON.stringify(warning)} warning={warning} onRefresh={onRefresh} showURI={true} />)}
  </section>
}

function IntegrityWarning({ warning, onRefresh, showURI }: { readonly warning: CamIntegrityWarning; readonly onRefresh: RefreshIntegrity | undefined; readonly showURI: boolean }): ReactElement {
  const [latest, setLatest] = useState<CamIntegrityCheck | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<FailureReport | undefined>(undefined)
  const pending = useRef<AbortController | undefined>(undefined)
  useEffect(() => () => pending.current?.abort(), [])
  // silent-defaults: allow-default -- Show the original warning until a later check completes.
  const checked = latest ?? warning
  const changed = checked.uri !== warning.uri || checked.actualHash.toLowerCase() !== warning.actualHash.toLowerCase()
  const hashLocation = checked.hashSource === "contract" ? "stored in the contract" : "specified in the app manifest"
  const message = checked.status === "verified" ? `The latest download matches the verification hash ${hashLocation}.`
    : checked.status === "mismatch" ? `This file does not match the verification hash ${hashLocation}.`
    : `This file could not be verified. The verification hash ${hashLocation} is zero.`

  async function refresh(): Promise<void> {
    if (onRefresh === undefined || pending.current !== undefined) return
    const controller = new AbortController()
    pending.current = controller
    setBusy(true)
    setFailure(undefined)
    try {
      const result = await onRefresh(warning, controller.signal)
      if (!controller.signal.aborted) setLatest(result)
    } catch (error) {
      if (!controller.signal.aborted) setFailure(failureReport(error, "Cannot refresh these hashes. The displayed hashes have not changed."))
    } finally {
      if (!controller.signal.aborted) setBusy(false)
      if (pending.current === controller) pending.current = undefined
    }
  }

  return <FeedbackBox kind={checked.status === "mismatch" ? "error" : checked.status === "verified" && !changed ? "status" : "warning"} message={message}>
    <div className="integrity-resource">
      {showURI ? <p>{viewerErrorMessage(checked.uri)}</p> : null}
      {onRefresh === undefined ? null : <button className="button-quiet integrity-refresh" type="button" aria-label="Refresh hashes" title="Refresh hashes" aria-busy={busy} disabled={busy} onClick={() => { void refresh() }}>
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M20 11a8 8 0 1 0-2 6M20 4v7h-7" /></svg>
      </button>}
    </div>
    <PropertyRow label="Expected hash" value={checked.expectedHash} />
    <PropertyRow label="Downloaded hash" value={checked.actualHash} />
    {changed ? <p>The file has changed since it was loaded. Refreshing hashes does not reload the app.</p> : null}
    {failure === undefined ? null : <Feedback kind="error" report={failure} />}
  </FeedbackBox>
}
