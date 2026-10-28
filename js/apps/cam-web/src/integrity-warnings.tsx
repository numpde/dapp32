import type { ReactElement } from "react"
import type { CamViewerLoadedSnapshot } from "@cam/viewer"
import { viewerErrorMessage } from "@cam/viewer"
import { FeedbackBox } from "./feedback.tsx"
import { PropertyRow } from "./property-row.tsx"

export function IntegrityWarnings({ warnings, reloadDisabled }: {
  readonly warnings: CamViewerLoadedSnapshot["integrityWarnings"]
  readonly reloadDisabled?: boolean
}): ReactElement | null {
  if (warnings.length === 0) return null
  return <section aria-label="UI integrity warnings">
    {warnings.map((warning, index) => <FeedbackBox key={`${index}:${warning.uri}`} kind={warning.status === "mismatch" ? "error" : "warning"}
      message={warning.status === "mismatch" ? "File hash mismatch. This file differs from its published hash." : "Unverified file. Its published verification hash is zero."}>
      <p>{viewerErrorMessage(warning.uri)}</p>
      <PropertyRow label="Expected hash" value={warning.expectedHash} />
      <PropertyRow label="Downloaded hash" value={warning.actualHash} />
    </FeedbackBox>)}
    <button className="button-quiet" type="button" disabled={reloadDisabled} onClick={() => window.location.reload()}>Reload page</button>
  </section>
}
