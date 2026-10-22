import { viewerErrorMessage } from "@cam/viewer"

export class UserFacingError extends Error {}

export type FailureReport = { readonly message: string; readonly diagnostic?: string }

export function failureReport(error: unknown, explanation?: string): FailureReport {
  let diagnostic: string | undefined = viewerErrorMessage(error, { whitespace: "collapse" })
  let primary = explanation
  try {
    if (error instanceof UserFacingError && (explanation === undefined || explanation === error.message)) {
      primary = error.message
      const cause = error.cause
      diagnostic = cause === undefined ? undefined : viewerErrorMessage(cause, { whitespace: "collapse" })
    }
  } catch { /* Untrusted prototypes and accessors cannot replace the original diagnostic. */ }
  const message = typeof primary === "string" ? viewerErrorMessage(primary, { whitespace: "collapse" }) : "Cannot complete this operation."
  return { message, ...(diagnostic === undefined || diagnostic === message ? {} : { diagnostic }) }
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
