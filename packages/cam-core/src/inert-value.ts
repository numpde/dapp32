import { CamError } from "./errors.ts"
import { isRecordObject, joinPath } from "./internal/json.ts"

// Inert values are boundary-safe data: JSON-compatible, deeply cloneable, and
// free of functions, prototypes, host handles, cycles, and hidden mutability.
export type InertValue =
  | null
  | boolean
  | number
  | string
  | readonly InertValue[]
  | InertRecord

export type InertRecord = {
  readonly [key: string]: InertValue
}

export function isInertValue(value: unknown): value is InertValue {
  return isInertValueAtPath(value, new WeakSet<object>())
}

export function assertInertValue(value: unknown, path = "value"): asserts value is InertValue {
  assertInertValueAtPath(value, path, new WeakSet<object>())
}

export function cloneInertValue(value: unknown, path = "value"): InertValue {
  assertInertValue(value, path)
  return cloneValidatedInertValue(value)
}

function isInertValueAtPath(value: unknown, seen: WeakSet<object>): boolean {
  if (isInertScalar(value)) {
    return true
  }

  if (Array.isArray(value)) {
    if (seen.has(value)) {
      return false
    }

    seen.add(value)
    for (let index = 0; index < value.length; index++) {
      if (!(index in value) || !isInertValueAtPath(value[index], seen)) {
        return false
      }
    }

    seen.delete(value)
    return true
  }

  if (isRecordObject(value)) {
    if (seen.has(value)) {
      return false
    }

    seen.add(value)
    for (const item of Object.values(value)) {
      if (!isInertValueAtPath(item, seen)) {
        return false
      }
    }

    seen.delete(value)
    return true
  }

  return false
}

function assertInertValueAtPath(value: unknown, path: string, seen: WeakSet<object>): void {
  if (isInertScalar(value)) {
    return
  }

  if (typeof value === "number") {
    throw new CamError("CAM_INVALID_FIELD", "expected a finite number", path)
  }

  if (Array.isArray(value)) {
    if (seen.has(value)) {
      throw new CamError("CAM_INVALID_FIELD", "inert values must not contain cycles", path)
    }

    seen.add(value)
    for (let index = 0; index < value.length; index++) {
      const itemPath = joinPath(path, String(index))
      if (!(index in value)) {
        throw new CamError("CAM_INVALID_FIELD", "expected an inert value", itemPath)
      }

      assertInertValueAtPath(value[index], itemPath, seen)
    }

    seen.delete(value)
    return
  }

  if (isRecordObject(value)) {
    if (seen.has(value)) {
      throw new CamError("CAM_INVALID_FIELD", "inert values must not contain cycles", path)
    }

    seen.add(value)
    for (const [key, item] of Object.entries(value)) {
      assertInertValueAtPath(item, joinPath(path, key), seen)
    }

    seen.delete(value)
    return
  }

  throw new CamError("CAM_INVALID_FIELD", "expected an inert value", path)
}

function cloneValidatedInertValue(value: InertValue): InertValue {
  if (Array.isArray(value)) {
    return value.map((item) => cloneValidatedInertValue(item))
  }

  if (isRecordObject(value)) {
    const record = Object.create(null) as Record<string, InertValue>
    for (const [key, item] of Object.entries(value)) {
      record[key] = cloneValidatedInertValue(item)
    }

    return record
  }

  return value
}

function isInertScalar(value: unknown): value is null | boolean | number | string {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return true
  }

  return typeof value === "number" && Number.isFinite(value)
}
