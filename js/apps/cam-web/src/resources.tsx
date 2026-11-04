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

const resourceDescriptions = {
  manifest: {
    label: "Manifest",
    description: "The manifest is the app’s setup document: it lists contract calls and links to supporting files, including the UI (user interface) file. The selected contract supplies its location and expected hash.",
  },
  ui: {
    label: "UI",
    description: "The UI (user interface) file defines the app’s screens, fields, and buttons. The manifest, the app’s setup document, points to this file and supplies its expected hash.",
  },
  resource: {
    label: "Resource",
    description: "This is a supporting file linked by the manifest, the app’s setup document. The manifest supplies its location and expected hash.",
  },
}

export function Resources({ snapshot }: {
  readonly snapshot: { readonly camURI?: string; readonly uiURI?: string; readonly integrityChecks: readonly CamIntegrityCheck[] }
}): ReactElement | null {
  const rows = new Map<string, { label: string; description: string; check: CamIntegrityCheck }>()
  for (const check of snapshot.integrityChecks) {
    const kind = check.hashSource === "contract" ? "manifest" : check.uri === snapshot.uiURI ? "ui" : "resource"
    if (kind === "resource" && check.status === "verified") continue
    rows.set(`${check.hashSource}:${check.uri}`, { ...resourceDescriptions[kind], check })
  }
  if (rows.size === 0) return null
  return <section className="resources" aria-label="Resources">
    <h2>Resources</h2>
    {[...rows].map(([key, row]) => <ResourceRow key={key} {...row} />)}
  </section>
}

function ResourceRow({ label, description, check }: {
  readonly label: string; readonly description: string; readonly check: CamIntegrityCheck
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
      <button className="resource-status button-quiet" data-kind={integrityKind(check.status)} type="button" aria-haspopup="dialog" aria-label={`${label} verification: ${statusLabel}`} onClick={() => setShowDetails(true)}>{statusLabel}</button>
      <CopyRecovery failure={failure} label={`${label} URI`} value={uri} />
    </div>
    <DismissibleDialog open={showDetails} label={`${label} verification`} onDismiss={() => setShowDetails(false)}>
      {!showDetails ? null : <><h2>{label} verification</h2><IntegrityDetails check={check} description={description} /><button type="button" className="button-quiet" onClick={() => setShowDetails(false)}>Close</button></>}
    </DismissibleDialog>
  </div>
}

function IntegrityDetails({ check, description }: { readonly check: CamIntegrityCheck; readonly description: string }): ReactElement {
  const hashLocation = check.hashSource === "contract" ? "stored in the contract" : "specified in the app manifest"
  const message = check.status === "verified" ? `The loaded file matches the verification hash ${hashLocation}.`
    : check.status === "mismatch" ? `The loaded file does not match the verification hash ${hashLocation}.`
    : `The loaded file could not be verified. The verification hash ${hashLocation} is zero.`
  return <div className="verification-facts">
    <p>{description}</p>
    <p>A hash is a fingerprint of a file’s contents. The loaded hash describes the file checked during app loading.</p>
    <div className="verification-summary">
      <FeedbackBox kind={integrityKind(check.status)} message={message} />
    </div>
    {check.hashSource === "manifest" ? <p>Matching this file does not verify the manifest itself.</p> : null}
    <PropertyRow label="Expected hash" value={check.expectedHash} />
    <PropertyRow label="Loaded hash" value={check.actualHash} />
  </div>
}

function integrityKind(status: CamIntegrityCheck["status"]): "status" | "warning" | "error" {
  return status === "verified" ? "status" : status === "mismatch" ? "error" : "warning"
}
