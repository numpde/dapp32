import {
  isExpressionArrayIndex,
  isRecordObject,
  joinPath,
} from "@cam/protocol"

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
  if (Array.isArray(value) && isExpressionArrayIndex(segment)) {
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
