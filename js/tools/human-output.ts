export function formatHumanOutput(value: string, maxLength: number): string {
  const parts: string[] = []
  let length = 0
  for (const character of value) {
    const code = character.charCodeAt(0)
    const displayed = code < 32 || code === 127
      ? `\\u${code.toString(16).padStart(4, "0")}`
      : character
    if (length + displayed.length > maxLength) {
      parts.push(displayed.slice(0, maxLength - length), "...")
      return parts.join("")
    }
    parts.push(displayed)
    length += displayed.length
  }
  return parts.join("")
}
