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

export function formatDisplayText(value: string): string {
  // formatValue feeds the human terminal render/prompt path. Keep structured
  // JSON commands unbounded, but avoid accidental screen floods from RPC/CAM
  // values during ordinary interactive rendering.
  return value.length <= MAX_FORMAT_VALUE_LENGTH
    ? value
    : `${value.slice(0, MAX_FORMAT_VALUE_LENGTH)}...`
}
