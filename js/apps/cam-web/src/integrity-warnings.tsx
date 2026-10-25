import type { ReactElement } from "react"
import type { CamViewerLoadedSnapshot } from "@cam/viewer"
import { viewerErrorMessage } from "@cam/viewer"
import { PropertyRow } from "./property-row.tsx"

export function IntegrityWarnings({ warnings }: { readonly warnings: CamViewerLoadedSnapshot["integrityWarnings"] }): ReactElement | null {
  if (warnings.length === 0) return null
  return <section aria-label="UI integrity warnings">
    {warnings.map((warning, index) => <div key={`${index}:${warning.uri}`} className="error-feedback" data-kind={warning.status === "mismatch" ? "error" : "warning"} role={warning.status === "mismatch" ? "alert" : "status"}>
      <p className="feedback-message">{warning.status === "mismatch" ? "File hash mismatch. This file differs from its published hash." : "Unverified file. Its published verification hash is zero."}</p>
      <p>{viewerErrorMessage(warning.uri)}</p>
      <PropertyRow label="Expected hash" value={warning.expectedHash} />
      <PropertyRow label="Downloaded hash" value={warning.actualHash} />
    </div>)}
  </section>
}
