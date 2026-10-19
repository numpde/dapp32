import { viewerErrorMessage } from "../../packages/cam-viewer/dist/index.js"
import { formatHumanOutput } from "../human-output.ts"

const MAX_FORMAT_VALUE_LENGTH = 2_000

export function formatValue(value: unknown): string {
  if (typeof value === "bigint") {
    return formatDisplayText(value.toString())
  }

  if (typeof value === "string") {
    return formatDisplayText(value)
  }

  let text: string
  try {
    const json = JSON.stringify(value)
    text = json === undefined ? String(value) : json
  } catch {
    text = "[unprintable value]"
  }
  return formatDisplayText(text)
}

export function formatError(error: unknown): string {
  return `Error: ${formatDisplayText(viewerErrorMessage(error))}\n`
}

export function formatDisplayText(value: string): string {
  // Human terminal values escape C0/DEL before the display bound; structured
  // command JSON remains unchanged. CLI line separators belong to callers.
  return formatHumanOutput(value, MAX_FORMAT_VALUE_LENGTH)
}
