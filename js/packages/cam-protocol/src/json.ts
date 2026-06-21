export function hasOwn(source: Record<string, unknown>, key: string): boolean {
  return Object.hasOwn(source, key)
}

export function createStringMap<T>(): Record<string, T> {
  // Protocol maps are JSON string maps. A null prototype keeps keys such as
  // "__proto__" as ordinary data instead of object behavior.
  return Object.create(null) as Record<string, T>
}

export function isRecordObject(value: unknown): value is Record<string, unknown> {
  // CAM and screen documents use JSON-style field maps. Arrays, null, and class
  // instances are not protocol records.
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false
  }

  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

export function isNonStringJsonScalar(value: unknown): boolean {
  if (value === null || typeof value === "boolean") {
    return true
  }

  return typeof value === "number" && Number.isFinite(value)
}

export function joinPath(parent: string, key: string): string {
  // The empty parent is the internal root path. Do not emit a leading dot for
  // first-level fields; public paths should read "owner", not ".owner".
  return parent === "" ? key : `${parent}.${key}`
}

export function parseJsonText(text: string): unknown {
  rejectDuplicateObjectKeys(text)
  return JSON.parse(text)
}

export function parseJsonBytes(bytes: Uint8Array): unknown {
  return parseJsonText(new TextDecoder().decode(bytes))
}

function rejectDuplicateObjectKeys(text: string): void {
  // JSON.parse uses last-key-wins semantics. CAM resources are reviewable
  // protocol documents, so duplicate object keys must fail before parsing.
  let index = 0

  skipWhitespace()
  scanValue()
  skipWhitespace()

  function scanValue(): void {
    skipWhitespace()
    const character = text[index]

    if (character === "{") {
      scanObject()
      return
    }
    if (character === "[") {
      scanArray()
      return
    }
    if (character === "\"") {
      scanString()
      return
    }

    scanScalar()
  }

  function scanObject(): void {
    index++
    const keys = new Set<string>()
    skipWhitespace()
    if (text[index] === "}") {
      index++
      return
    }

    while (index < text.length) {
      skipWhitespace()
      const key = scanString()
      if (keys.has(key)) {
        throw new SyntaxError(`duplicate JSON object key is not allowed: ${key}`)
      }
      keys.add(key)

      skipWhitespace()
      if (text[index] !== ":") return
      index++
      scanValue()
      skipWhitespace()

      if (text[index] === "}") {
        index++
        return
      }
      if (text[index] !== ",") return
      index++
    }
  }

  function scanArray(): void {
    index++
    skipWhitespace()
    if (text[index] === "]") {
      index++
      return
    }

    while (index < text.length) {
      scanValue()
      skipWhitespace()

      if (text[index] === "]") {
        index++
        return
      }
      if (text[index] !== ",") return
      index++
    }
  }

  function scanString(): string {
    const start = index
    index++

    while (index < text.length) {
      const character = text[index]
      if (character === "\"") {
        index++
        return JSON.parse(text.slice(start, index)) as string
      }
      if (character === "\\") {
        index += 2
        continue
      }
      index++
    }

    return JSON.parse(text.slice(start, index)) as string
  }

  function scanScalar(): void {
    while (index < text.length) {
      const character = text[index]
      if (character === undefined || /[\s,\]}]/.test(character)) break
      index++
    }
  }

  function skipWhitespace(): void {
    while (index < text.length) {
      const character = text[index]
      if (character === undefined || !/\s/.test(character)) break
      index++
    }
  }
}

export type JsonGuardErrorKind = "notObject" | "invalidField"

export type JsonGuards = {
  readonly requiredRecord: (value: unknown, path: string) => Record<string, unknown>
  readonly requiredArray: (value: unknown, path: string) => readonly unknown[]
  readonly requiredNonEmptyString: (value: unknown, path: string) => string
  readonly rejectUnknownFields: (
    source: Record<string, unknown>,
    allowedKeys: ReadonlySet<string>,
    path: string,
    message: (key: string) => string,
  ) => void
}

export type JsonGuardsOptions = {
  readonly requireExplicitArrays?: boolean
  readonly error: (kind: JsonGuardErrorKind, message: string, path?: string) => Error
}

export function createJsonGuards(options: JsonGuardsOptions): JsonGuards {
  function requiredRecord(value: unknown, path: string): Record<string, unknown> {
    if (!isRecordObject(value)) {
      // The root path is represented as absent in public errors. Nested paths
      // stay explicit so parser failures remain local.
      throw options.error(path === "" ? "notObject" : "invalidField", "expected an object", path || undefined)
    }

    return value
  }

  function requiredArray(value: unknown, path: string): readonly unknown[] {
    if (options.requireExplicitArrays === true && value === undefined) {
      throw options.error("invalidField", "expected an explicit array", path)
    }

    if (!Array.isArray(value)) {
      throw options.error("invalidField", "expected an array", path)
    }

    for (let index = 0; index < value.length; index++) {
      if (!(index in value)) {
        throw options.error("invalidField", "expected a JSON value", joinPath(path, String(index)))
      }
    }

    return value
  }

  function requiredNonEmptyString(value: unknown, path: string): string {
    if (typeof value !== "string") {
      throw options.error("invalidField", "expected a string", path)
    }

    if (value.length === 0) {
      throw options.error("invalidField", "expected a non-empty string", path)
    }

    return value
  }

  function rejectUnknownFields(
    source: Record<string, unknown>,
    allowedKeys: ReadonlySet<string>,
    path: string,
    message: (key: string) => string,
  ): void {
    for (const key of Object.keys(source)) {
      if (!allowedKeys.has(key)) {
        throw options.error("invalidField", message(key), joinPath(path, key))
      }
    }
  }

  return {
    requiredRecord,
    requiredArray,
    requiredNonEmptyString,
    rejectUnknownFields,
  }
}
