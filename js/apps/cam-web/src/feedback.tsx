import type { ReactElement, Ref } from "react"
import type { FailureReport } from "./errors.ts"

export function Feedback({ report, kind, className, messageRef }: {
  readonly report: FailureReport
  readonly kind: "error" | "status"
  readonly className?: string
  readonly messageRef?: Ref<HTMLParagraphElement>
}): ReactElement {
  return <div className="error-feedback">
    <p className={className} ref={messageRef} tabIndex={messageRef === undefined ? undefined : -1} role={kind === "error" ? "alert" : "status"}>{report.message}</p>
    {report.diagnostic === undefined ? null : <details><summary>Technical details</summary><code>{report.diagnostic}</code></details>}
  </div>
}
