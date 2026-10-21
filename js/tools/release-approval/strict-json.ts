type JsonLocation = "id" | "params" | "other"

export class RpcJsonError extends Error {
  readonly reason: "syntax" | "duplicate-key" | "depth" | "number-form" | "unsafe-integer"
  readonly offset: number
  readonly location: JsonLocation
  constructor(reason: RpcJsonError["reason"], offset: number, location: JsonLocation) {
    super(`Cannot parse RPC JSON: ${reason} at character ${offset}`)
    this.reason = reason
    this.offset = offset
    this.location = location
  }
}

export function parseStrictJson(source: string): unknown {
  let cursor = 0
  function fail(reason: RpcJsonError["reason"], location: JsonLocation): never {
    throw new RpcJsonError(reason, cursor, location)
  }
  function whitespace() { while (/[\t\n\r ]/.test(source.charAt(cursor)) && cursor < source.length) cursor++ }
  function string(location: JsonLocation): string {
    const start = cursor
    if (source[cursor++] !== '"') fail("syntax", location)
    let escaped = false
    while (cursor < source.length) {
      const char = source[cursor++]
      if (escaped) { escaped = false; continue }
      if (char === "\\") { escaped = true; continue }
      if (char === '"') {
        try { return JSON.parse(source.slice(start, cursor)) as string }
        catch { fail("syntax", location) }
      }
      if (char.charCodeAt(0) < 0x20) fail("syntax", location)
    }
    fail("syntax", location)
  }
  function value(depth: number, location: JsonLocation): void {
    if (depth > 64) fail("depth", location)
    whitespace()
    const char = source[cursor]
    if (char === '"') { string(location); return }
    if (char === "{") {
      cursor++
      const keys = new Set<string>()
      whitespace()
      if (source[cursor] === "}") { cursor++; return }
      for (;;) {
        whitespace()
        const key = string(location)
        if (keys.has(key)) fail("duplicate-key", location)
        keys.add(key)
        whitespace()
        if (source[cursor++] !== ":") fail("syntax", location)
        const childLocation = depth === 0 ? (key === "id" || key === "params" ? key : "other") : location
        value(depth + 1, childLocation)
        whitespace()
        const separator = source[cursor++]
        if (separator === "}") return
        if (separator !== ",") fail("syntax", location)
      }
    }
    if (char === "[") {
      cursor++
      whitespace()
      if (source[cursor] === "]") { cursor++; return }
      for (;;) {
        value(depth + 1, location)
        whitespace()
        const separator = source[cursor++]
        if (separator === "]") return
        if (separator !== ",") fail("syntax", location)
      }
    }
    const rest = source.slice(cursor)
    const primitive = /^(?:true|false|null|-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?)/.exec(rest)
    if (!primitive) fail("syntax", location)
    const token = primitive[0]
    if (/^-?[0-9]/.test(token)) {
      if (!/^-?(?:0|[1-9][0-9]*)$/.test(token) || token === "-0") fail("number-form", location)
      if (token.length > 17 || !Number.isSafeInteger(Number(token))) fail("unsafe-integer", location)
    }
    cursor += primitive[0].length
  }
  value(0, "other")
  whitespace()
  if (cursor !== source.length) fail("syntax", "other")
  return JSON.parse(source) as unknown
}
