import type { InertValue } from "@cam/protocol"

const MAX_DISPLAY_TEXT_LENGTH = 2_000

export function formatInertValue(value: InertValue): string {
  if (value === null) return "null"
  if (typeof value === "string") return displayText(value)
  if (typeof value === "number" || typeof value === "boolean") return String(value)
  return displayText(JSON.stringify(value))
}

export function displayText(value: string): string {
  // UI manifests and contract outputs are untrusted display data. Keep the
  // rendered browser surface bounded while leaving TextField state unmodified.
  return value.length <= MAX_DISPLAY_TEXT_LENGTH
    ? value
    : `${value.slice(0, MAX_DISPLAY_TEXT_LENGTH)}...`
}
