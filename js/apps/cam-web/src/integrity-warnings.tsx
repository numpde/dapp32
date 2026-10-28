import { useEffect, useRef, useState } from "react"
import type { ReactElement } from "react"
import type { CamViewerLoadedSnapshot } from "@cam/viewer"
import type { CamIntegrityCheck, CamIntegrityWarning } from "@cam/evm-viem"
import { viewerErrorMessage } from "@cam/viewer"
import { FeedbackBox } from "./feedback.tsx"
import { PropertyRow } from "./property-row.tsx"
import { Feedback } from "./feedback.tsx"
import { failureReport } from "./errors.ts"
import type { FailureReport } from "./errors.ts"

type RefreshIntegrity = (warning: CamIntegrityWarning, signal: AbortSignal) => Promise<CamIntegrityCheck>

export function IntegrityWarnings({ warnings, onRefresh }: {
  readonly warnings: CamViewerLoadedSnapshot["integrityWarnings"]
  readonly onRefresh?: RefreshIntegrity
}): ReactElement | null {
  if (warnings.length === 0) return null
  return <section aria-label="UI integrity warnings">
    {warnings.map(warning => <IntegrityWarning key={JSON.stringify(warning)} warning={warning} onRefresh={onRefresh} />)}
  </section>
}

function IntegrityWarning({ warning, onRefresh }: { readonly warning: CamIntegrityWarning; readonly onRefresh: RefreshIntegrity | undefined }): ReactElement {
  const [latest, setLatest] = useState<CamIntegrityCheck | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<FailureReport | undefined>(undefined)
  const pending = useRef<AbortController | undefined>(undefined)
  useEffect(() => () => pending.current?.abort(), [])
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
      <p>{viewerErrorMessage(checked.uri)}</p>
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
