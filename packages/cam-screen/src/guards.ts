import { ScreenError } from "./errors.ts"

export function hasOwn(source: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(source, key)
}

export function createStringMap<T>(): Record<string, T> {
  return Object.create(null) as Record<string, T>
}

export function isRecordObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false
  }

  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

export function requiredRecord(value: unknown, path: string): Record<string, unknown> {
  if (!isRecordObject(value)) {
    throw new ScreenError(
      path === "" ? "SCREEN_NOT_OBJECT" : "SCREEN_INVALID_FIELD",
      "expected an object",
      path || undefined,
    )
  }

  return value
}

export function requiredArray(value: unknown, path: string): readonly unknown[] {
  if (!Array.isArray(value)) {
    throw new ScreenError("SCREEN_INVALID_FIELD", "expected an array", path)
  }

  return value
}

export function requiredNonEmptyString(value: unknown, path: string): string {
  if (typeof value !== "string") {
    throw new ScreenError("SCREEN_INVALID_FIELD", "expected a string", path)
  }

  if (value.length === 0) {
    throw new ScreenError("SCREEN_INVALID_FIELD", "expected a non-empty string", path)
  }

  return value
}

export function rejectUnknownFields(
  source: Record<string, unknown>,
  allowedKeys: ReadonlySet<string>,
  path: string,
  message: (key: string) => string,
): void {
  for (const key of Object.keys(source)) {
    if (!allowedKeys.has(key)) {
      throw new ScreenError("SCREEN_INVALID_FIELD", message(key), joinPath(path, key))
    }
  }
}

export function cloneJsonValue(value: unknown): unknown {
  // TODO(inert-values): screen documents and actions should use
  // toInertValue/cloneInertValue instead of this package-local JSON clone.
  if (Array.isArray(value)) {
    return value.map((item) => cloneJsonValue(item))
  }

  if (isRecordObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, cloneJsonValue(item)]),
    )
  }

  return value
}

function joinPath(parent: string, key: string): string {
  return parent === "" ? key : `${parent}.${key}`
}
