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

function isRecordObject(value: unknown): value is Record<string, unknown> {
  // Keep this helper local: generic conformance facets are deliberately not
  // coupled to runtime protocol packages, and the repo checks enforce that.
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false
  }

  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function joinPath(parent: string, key: string): string {
  return parent === "" ? key : `${parent}.${key}`
}
