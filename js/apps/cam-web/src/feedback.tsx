import { useEffect, useState } from "react"
import type { ReactElement, ReactNode, Ref } from "react"
import { transactionExplorer } from "./transactions.ts"
import type { SubmittedTransactionReference } from "./transactions.ts"
import { failureReport } from "./errors.ts"
import type { FailureReport } from "./errors.ts"

export function Feedback({ report, kind, className, messageRef, children }: {
  readonly report: FailureReport
  readonly kind: "error" | "status"
  readonly className?: string
  readonly messageRef?: Ref<HTMLParagraphElement>
  readonly children?: ReactNode
}): ReactElement {
  return <div className={className === undefined ? "error-feedback" : `error-feedback ${className}`} data-kind={kind} role={kind === "error" ? "alert" : "status"}>
    <p className="feedback-message" ref={messageRef} tabIndex={messageRef === undefined ? undefined : -1}>{children === undefined ? report.message : children}</p>
    {report.diagnostic === undefined ? null : <code className="feedback-diagnostic">{report.diagnostic}</code>}
  </div>
}

type ExplorerResult = { readonly transaction: SubmittedTransactionReference } & (
  | { readonly status: "ready"; readonly explorer: Awaited<ReturnType<typeof transactionExplorer>> }
  | { readonly status: "failed"; readonly failure: FailureReport }
)

export function TransactionFeedback({ report, kind, transaction, messageRef }: {
  readonly report: FailureReport
  readonly kind: "error" | "status"
  readonly transaction: SubmittedTransactionReference | undefined
  readonly messageRef?: Ref<HTMLParagraphElement>
}): ReactElement {
  const [result, setResult] = useState<ExplorerResult | undefined>(undefined)
  useEffect(() => {
    if (transaction === undefined) return
    let active = true
    void transactionExplorer(transaction).then(
      explorer => { if (active) setResult({ transaction, status: "ready", explorer }) },
      error => { if (active) setResult({ transaction, status: "failed", failure: failureReport(error, "Cannot load block explorer details.") }) },
    )
    return () => { active = false }
  }, [transaction?.chainId, transaction?.hash])
  const current = result?.transaction.chainId === transaction?.chainId && result?.transaction.hash === transaction?.hash ? result : undefined
  const explorer = current?.status === "ready" ? current.explorer : undefined
  return <>
    <Feedback report={report} kind={kind} className="notice" {...(messageRef === undefined ? {} : { messageRef })}>
      {report.message}{transaction === undefined ? null : <> Transaction hash: <code>{explorer === undefined ? transaction.hash : <a href={explorer.url} target="_blank" rel="noopener noreferrer" aria-label={`View transaction on ${explorer.name}`}>{transaction.hash}</a>}</code></>}
    </Feedback>
    {current?.status === "failed" ? <Feedback report={current.failure} kind="error" /> : null}
  </>
}
