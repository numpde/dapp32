import type { ReactElement } from "react"
import type { CamViewerLoadedSnapshot } from "@cam/viewer"
import { viewerErrorMessage } from "@cam/viewer"

export function IntegrityWarnings({ warnings }: { readonly warnings: CamViewerLoadedSnapshot["integrityWarnings"] }): ReactElement | null {
  if (warnings.length === 0) return null
  return <section aria-label="UI integrity warnings">
    {warnings.map((warning, index) => <div key={`${index}:${warning.uri}`} className="error-feedback" data-kind={warning.status === "mismatch" ? "error" : "status"} role={warning.status === "mismatch" ? "alert" : "status"}>
      <p className="feedback-message">{warning.status === "mismatch" ? "File hash mismatch. This file differs from its published hash." : "No verification hash. This file’s published hash is zero."}</p>
      <p>{viewerErrorMessage(warning.uri)}</p>
      <code className="feedback-diagnostic">Expected: {warning.expectedHash}{"\n"}Downloaded: {warning.actualHash}</code>
    </div>)}
    <p>The UI is displayed despite these warnings. Its integrity has not been confirmed. Matching hashes for other files do not authenticate an unverified CAM manifest.</p>
  </section>
}
