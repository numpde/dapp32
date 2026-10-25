import { viewerErrorMessage } from "@cam/viewer"
import { CamEvmError } from "@cam/evm-viem"
import { ContractFunctionExecutionError, ContractFunctionRevertedError } from "viem"

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
  const readableLabel = typeof label === "string" && isReadableErrorText(label) ? viewerErrorMessage(label.trim()) : undefined
  const action = readableLabel === undefined ? "This action" : readableLabel
  let explanation = readableLabel === undefined ? "Cannot complete this action." : `${action} failed.`
  try {
    if (error instanceof CamEvmError) {
      if (error.code === "CAM_WRITE_INVALID_ARGUMENT" || error.code === "CAM_ROUTE_INVALID_ARGUMENT") {
        explanation = `${action} failed. Correct the input values and try again.`
      } else if (error.cause instanceof ContractFunctionExecutionError && error.cause.cause instanceof ContractFunctionRevertedError) {
        const revert = error.cause.cause
        if (revert.data !== undefined) {
          // Decoded contract evidence supersedes generic transport wrappers.
          // Keep the original thrown chain intact; select only its known stage and revert for display.
          return failureReport({ message: error.message, cause: { shortMessage: revert.shortMessage, data: revert.data, reason: revert.reason } }, `${action} was rejected by the contract.`)
        }
      }
    }
  } catch { /* Provider-controlled objects cannot replace the original failure while it is being described. */ }
  return failureReport(error, explanation)
}

function isReadableErrorText(value: string): boolean {
  const text = value.trim()
  return text.length > 0
    && text !== "[object Object]"
    && !/[\u0000-\u001F\u007F]/u.test(text)
}
