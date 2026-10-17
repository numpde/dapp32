import { viewerErrorMessage } from "@cam/viewer"

export { viewerErrorMessage as errorMessage } from "@cam/viewer"

const MAX_ERROR_TEXT_LENGTH = 500

export function actionErrorMessage(error: unknown, label: unknown): string {
  const diagnostic = viewerErrorMessage(error)
  return typeof label === "string" && isReadableErrorText(label)
    ? `${boundedErrorText(label.trim())} failed: ${diagnostic}`
    : diagnostic
}

function isReadableErrorText(value: string): boolean {
  const text = value.trim()
  return text.length > 0
    && text !== "[object Object]"
    && !/[\u0000-\u001F\u007F]/u.test(text)
}

function boundedErrorText(value: string): string {
  return value.length <= MAX_ERROR_TEXT_LENGTH
    ? value
    : `${value.slice(0, MAX_ERROR_TEXT_LENGTH)}...`
}
