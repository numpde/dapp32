export function formatValue(value: unknown): string {
  if (typeof value === "bigint") {
    return value.toString()
  }

  if (typeof value === "string") {
    return value
  }

  const json = JSON.stringify(value)
  return json === undefined ? String(value) : json
}
