import { viewerErrorMessage } from "@cam/viewer"

export class UserFacingError extends Error {}

export type FailureReport = { readonly message: string; readonly diagnostic?: string }

export function failureReport(error: unknown, explanation?: string): FailureReport {
  const diagnostic = viewerErrorMessage(error)
  let primary = explanation
  if (primary === undefined) {
    try { if (error instanceof UserFacingError) primary = error.message }
    catch { /* An untrusted prototype or message accessor cannot replace the diagnostic. */ }
  }
  const message = typeof primary === "string" ? viewerErrorMessage(primary) : "Cannot complete this operation."
  const detail = diagnostic.startsWith(`${message}: `) ? diagnostic.slice(message.length + 2) : diagnostic
  return { message, ...(detail === message ? {} : { diagnostic: detail }) }
}

export function actionFailure(error: unknown, label: unknown): FailureReport {
  const explanation = typeof label === "string" && isReadableErrorText(label)
    ? `${viewerErrorMessage(label.trim())} failed.`
    : "Cannot complete this action."
  return failureReport(error, explanation)
}

function isReadableErrorText(value: string): boolean {
  const text = value.trim()
  return text.length > 0
    && text !== "[object Object]"
    && !/[\u0000-\u001F\u007F]/u.test(text)
}
