export function forEachString(
  value: unknown,
  path: string,
  visit: (value: string, path: string) => void,
): void {
  if (typeof value === "string") {
    visit(value, path)
    return
  }

  if (Array.isArray(value)) {
    value.forEach((item, index) => forEachString(item, joinPath(path, String(index)), visit))
    return
  }

  if (isRecordObject(value)) {
    for (const [key, item] of Object.entries(value)) {
      forEachString(item, joinPath(path, key), visit)
    }
  }
}

export function rawValueAtSegments(value: unknown, segments: readonly string[]): unknown | undefined {
  const [segment, ...rest] = segments
  if (segment === undefined) return value
  if (Array.isArray(value) && isArrayIndex(segment)) {
    return rawValueAtSegments(value[Number(segment)], rest)
  }
  if (isRecordObject(value) && Object.hasOwn(value, segment)) {
    return rawValueAtSegments(value[segment], rest)
  }

  return undefined
}

export function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined
}

function isRecordObject(value: unknown): value is Record<string, unknown> {
  // Keep root shared helpers dependency-free. Facet folders may import
  // @cam/protocol where they own protocol-level checks, but this file stays
  // usable from any conformance facet without widening that facet's imports.
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false
  }

  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function joinPath(parent: string, key: string): string {
  return parent === "" ? key : `${parent}.${key}`
}

export function isArrayIndex(value: string | undefined): value is string {
  return value === "0" || (value !== undefined && /^[1-9][0-9]*$/.test(value))
}
