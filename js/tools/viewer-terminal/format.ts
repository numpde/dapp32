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
  if (error instanceof Error) {
    return `Error: ${formatDisplayText(error.message)}\n`
  }

  return `Error: ${formatValue(error)}\n`
}

export function formatDisplayText(value: string): string {
  // Human terminal values escape C0/DEL before the display bound; structured
  // command JSON remains unchanged. CLI line separators belong to callers.
  const parts: string[] = []
  let length = 0
  for (const character of value) {
    const code = character.charCodeAt(0)
    const displayed = code < 32 || code === 127
      ? `\\u${code.toString(16).padStart(4, "0")}`
      : character
    if (length + displayed.length > MAX_FORMAT_VALUE_LENGTH) {
      parts.push(displayed.slice(0, MAX_FORMAT_VALUE_LENGTH - length), "...")
      return parts.join("")
    }
    parts.push(displayed)
    length += displayed.length
  }
  return parts.join("")
}
