import { useContext, useState } from "react"
import type { ReactElement } from "react"
import type { CamIntegrityCheck } from "@cam/evm-viem"
import { requireHttpURL, resolveIpfsGatewayURL } from "@cam/protocol"
import { DownloadContext } from "./download-context.ts"
import { useClipboardCopy } from "./clipboard.ts"
import { CopyButton, CopyRecovery } from "./copy-button.tsx"
import { FeedbackBox } from "./feedback.tsx"
import { DismissibleDialog } from "./dismissible-dialog.tsx"
import { PropertyRow } from "./property-row.tsx"

export function Resources({ snapshot }: {
  readonly snapshot: { readonly camURI?: string; readonly uiURI?: string; readonly integrityChecks: readonly CamIntegrityCheck[] }
}): ReactElement | null {
  const rows = new Map<string, { label: string; check: CamIntegrityCheck }>()
  for (const check of snapshot.integrityChecks) {
    const label = check.hashSource === "contract" ? "Manifest" : check.uri === snapshot.uiURI ? "UI" : "Resource"
    if (label === "Resource" && check.status === "verified") continue
    rows.set(`${check.hashSource}:${check.uri}`, { label, check })
  }
  if (rows.size === 0) return null
  return <section className="resources" aria-label="Resources">
    <h2>Resources</h2>
    {[...rows].map(([key, row]) => <ResourceRow key={key} {...row} />)}
  </section>
}

function ResourceRow({ label, check }: {
  readonly label: string; readonly check: CamIntegrityCheck
}): ReactElement {
  const { uri, hashSource } = check
  const statusLabel = check.status === "verified" ? hashSource === "contract" ? "Matches contract" : "Matches manifest"
    : check.status === "mismatch" ? "Hash mismatch" : "Not verified"
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
      <button className={`${check.status === "verified" ? "resource-status-ok" : "resource-status-warning"} button-quiet`} type="button" aria-haspopup="dialog" aria-label={`${label} verification: ${statusLabel}`} onClick={() => setShowDetails(true)}>{statusLabel}</button>
      <CopyRecovery failure={failure} label={`${label} URI`} value={uri} />
    </div>
    <DismissibleDialog open={showDetails} label={`${label} verification`} onDismiss={() => setShowDetails(false)}>
      {!showDetails ? null : <><h2>{label} verification</h2><IntegrityDetails check={check} /><button type="button" className="button-quiet" onClick={() => setShowDetails(false)}>Close</button></>}
    </DismissibleDialog>
  </div>
}

function IntegrityDetails({ check }: { readonly check: CamIntegrityCheck }): ReactElement {
  const hashLocation = check.hashSource === "contract" ? "stored in the contract" : "specified in the app manifest"
  const message = check.status === "verified" ? `The loaded file matches the verification hash ${hashLocation}.`
    : check.status === "mismatch" ? `The loaded file does not match the verification hash ${hashLocation}.`
    : `The loaded file could not be verified. The verification hash ${hashLocation} is zero.`
  return <div className="verification-facts">
    <div className="verification-summary">
      <FeedbackBox kind={check.status === "mismatch" ? "error" : check.status === "verified" ? "status" : "warning"} message={message} />
    </div>
    <PropertyRow label="Expected hash" value={check.expectedHash} />
    <PropertyRow label="Loaded hash" value={check.actualHash} />
  </div>
}
