export function parseStrictJson(source: string): unknown {
  let cursor = 0
  function whitespace() { while (/[\t\n\r ]/.test(source.charAt(cursor)) && cursor < source.length) cursor++ }
  function string(): string {
    const start = cursor
    if (source[cursor++] !== '"') throw new Error("Expected JSON string")
    let escaped = false
    while (cursor < source.length) {
      const char = source[cursor++]
      if (escaped) { escaped = false; continue }
      if (char === "\\") { escaped = true; continue }
      if (char === '"') return JSON.parse(source.slice(start, cursor)) as string
      if (char.charCodeAt(0) < 0x20) throw new Error("JSON string contains a control character")
    }
    throw new Error("Truncated JSON string")
  }
  function value(depth: number): void {
    if (depth > 64) throw new Error("JSON nesting is too deep")
    whitespace()
    const char = source[cursor]
    if (char === '"') { string(); return }
    if (char === "{") {
      cursor++
      const keys = new Set<string>()
      whitespace()
      if (source[cursor] === "}") { cursor++; return }
      for (;;) {
        whitespace()
        const key = string()
        if (keys.has(key)) throw new Error("JSON object has a duplicate key")
        keys.add(key)
        whitespace()
        if (source[cursor++] !== ":") throw new Error("Expected JSON object separator")
        value(depth + 1)
        whitespace()
        const separator = source[cursor++]
        if (separator === "}") return
        if (separator !== ",") throw new Error("Expected JSON object delimiter")
      }
    }
    if (char === "[") {
      cursor++
      whitespace()
      if (source[cursor] === "]") { cursor++; return }
      for (;;) {
        value(depth + 1)
        whitespace()
        const separator = source[cursor++]
        if (separator === "]") return
        if (separator !== ",") throw new Error("Expected JSON array delimiter")
      }
    }
    const rest = source.slice(cursor)
    const primitive = /^(?:true|false|null|-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?)/.exec(rest)
    if (!primitive) throw new Error("Invalid JSON value")
    const token = primitive[0]
    if (/^-?[0-9]/.test(token)) {
      if (!/^-?(?:0|[1-9][0-9]*)$/.test(token) || token === "-0" || token.length > 17 ||
          !Number.isSafeInteger(Number(token))) {
        throw new Error("JSON-RPC number must be an exact safe integer")
      }
    }
    cursor += primitive[0].length
  }
  value(0)
  whitespace()
  if (cursor !== source.length) throw new Error("JSON has trailing content")
  return JSON.parse(source) as unknown
}
