import { CamError } from "./errors.ts"

export function hasOwn(source: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(source, key)
}

export function createStringMap<T>(): Record<string, T> {
  // CAM maps are JSON string maps. A null prototype keeps keys such as
  // "__proto__" as ordinary data instead of object behavior.
  return Object.create(null) as Record<string, T>
}

export function isRecordObject(value: unknown): value is Record<string, unknown> {
  // CAM documents and runtime bags are JSON-style records. Arrays, null, and
  // class instances are not field maps.
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false
  }

  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

export function requiredRecord(value: unknown, path: string): Record<string, unknown> {
  if (!isRecordObject(value)) {
    throw new CamError(path === "" ? "CAM_NOT_OBJECT" : "CAM_INVALID_FIELD", "expected an object", path || undefined)
  }

  return value
}

function requiredString(value: unknown, path: string): string {
  if (typeof value !== "string") {
    throw new CamError("CAM_INVALID_FIELD", "expected a string", path)
  }

  return value
}

export function requiredNonEmptyString(value: unknown, path: string): string {
  const string = requiredString(value, path)
  if (string.length === 0) {
    throw new CamError("CAM_INVALID_FIELD", "expected a non-empty string", path)
  }

  return string
}

export function requiredArray(value: unknown, path: string): readonly unknown[] {
  if (value === undefined) {
    throw new CamError("CAM_INVALID_FIELD", "expected an explicit array", path)
  }

  if (!Array.isArray(value)) {
    throw new CamError("CAM_INVALID_FIELD", "expected an array", path)
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
      throw new CamError("CAM_INVALID_FIELD", message(key), joinPath(path, key))
    }
  }
}

function joinPath(parent: string, key: string): string {
  return parent === "" ? key : `${parent}.${key}`
}
