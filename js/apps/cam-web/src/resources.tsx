import { useContext, useState } from "react"
import type { ReactElement } from "react"
import { Popover } from "@base-ui/react/popover"
import type { CamIntegrityCheck } from "@cam/evm-viem"
import { requireHttpURL, resolveIpfsGatewayURL } from "@cam/protocol"
import { Icon } from "./icon.tsx"
import { DownloadContext } from "./download-context.ts"
import { useClipboardCopy } from "./clipboard.ts"
import { CopyButton, CopyRecovery } from "./copy-button.tsx"
import { FeedbackBox } from "./feedback.tsx"
import { DismissibleDialog } from "./dismissible-dialog.tsx"
import { PropertyRow } from "./property-row.tsx"

const resourceDescriptions = {
  manifest: {
    label: "Manifest",
    description: "The manifest is the app’s setup document. It lists contract calls and links to supporting files, including the UI (user interface) file.",
  },
  ui: {
    label: "UI",
    description: "The UI (user interface) file defines the app’s screens, fields, and buttons. It is linked from the manifest, the app’s setup document.",
  },
  resource: {
    label: "Resource",
    description: "This is a supporting file linked by the manifest, the app’s setup document.",
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
      {!showDetails ? null : <><ResourceHeading label={label} description={description} /><IntegrityDetails check={check} /><button type="button" className="button-quiet" onClick={() => setShowDetails(false)}>Close</button></>}
    </DismissibleDialog>
  </div>
}

function ResourceHeading({ label, description }: { readonly label: string; readonly description: string }): ReactElement {
  const [container, setContainer] = useState<HTMLDivElement | null>(null)
  return <div className="verification-heading" ref={setContainer}>
    <h2>{label} verification</h2>
    <Popover.Root>
      <Popover.Trigger className="resource-info" aria-label={`About ${label}`} openOnHover>
        <Icon name="info" size={18} />
      </Popover.Trigger>
      <Popover.Portal container={container} className="resource-info-portal">
        <Popover.Positioner positionMethod="fixed" collisionBoundary={container?.closest("dialog") ?? "clipping-ancestors"} side="bottom" align="start" sideOffset={8} collisionPadding={8} className="resource-info-positioner">
          <Popover.Popup className="resource-info-popup" aria-label={`About ${label}`} initialFocus={false}>
            <Popover.Description>{description}</Popover.Description>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  </div>
}

function IntegrityDetails({ check }: { readonly check: CamIntegrityCheck }): ReactElement {
  const hashLocation = check.hashSource === "contract" ? "stored in the contract" : "specified in the app manifest"
  const message = check.status === "verified" ? `The loaded file matches the verification hash ${hashLocation}.`
    : check.status === "mismatch" ? `The loaded file does not match the verification hash ${hashLocation}.`
    : `The loaded file could not be verified. The verification hash ${hashLocation} is zero.`
  return <div className="verification-facts">
    <div className="verification-summary">
      <FeedbackBox kind={integrityKind(check.status)} message={message} />
    </div>
    <PropertyRow label="Expected hash" value={check.expectedHash} />
    <PropertyRow label="Loaded hash" value={check.actualHash} />
  </div>
}

function integrityKind(status: CamIntegrityCheck["status"]): "status" | "warning" | "error" {
  return status === "verified" ? "status" : status === "mismatch" ? "error" : "warning"
}
