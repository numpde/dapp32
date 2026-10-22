import type { ReactElement, Ref } from "react"
import type { FailureReport } from "./errors.ts"

export function Feedback({ report, kind, className, messageRef }: {
  readonly report: FailureReport
  readonly kind: "error" | "status"
  readonly className?: string
  readonly messageRef?: Ref<HTMLParagraphElement>
}): ReactElement {
  return <div className={`error-feedback ${className ?? ""}`} data-kind={kind} role={kind === "error" ? "alert" : "status"}>
    <p className="feedback-message" ref={messageRef} tabIndex={messageRef === undefined ? undefined : -1}>{report.message}</p>
    {report.diagnostic === undefined ? null : <code className="feedback-diagnostic">{report.diagnostic}</code>}
  </div>
}
