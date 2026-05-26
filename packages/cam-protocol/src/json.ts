export function hasOwn(source: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(source, key)
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
  return JSON.parse(text)
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
