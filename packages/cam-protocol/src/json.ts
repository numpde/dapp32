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

export function isJsonScalar(value: unknown): boolean {
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
