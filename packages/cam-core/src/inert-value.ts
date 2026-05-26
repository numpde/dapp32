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
  return validateInertValue(value) === undefined
}

export function assertInertValue(value: unknown): asserts value is InertValue {
  const error = validateInertValue(value)

  if (error !== undefined) {
    throw error
  }
}

export function toInertValue(value: unknown): InertValue {
  assertInertValue(value)
  return cloneInertValue(value)
}

export function cloneInertValue(value: InertValue): InertValue {
  return cloneValidatedInertValue(value)
}

function inertError(message: string, path: string): CamError {
  return new CamError("CAM_INVALID_FIELD", message, path === "" ? undefined : path)
}

function validateInertValue(
  value: unknown,
  path: string = "",
  seen: WeakSet<object> = new WeakSet<object>(),
): CamError | undefined {
  if (isInertScalar(value)) {
    return undefined
  }

  if (typeof value === "number") {
    return inertError("expected a finite number", path)
  }

  if (Array.isArray(value)) {
    if (seen.has(value)) {
      return inertError("inert values must not contain cycles", path)
    }

    // `seen` is the active recursion stack. Remove the array on exit so
    // repeated references are allowed while true cycles are still rejected.
    seen.add(value)
    try {
      for (let index = 0; index < value.length; index++) {
        const itemPath = joinPath(path, String(index))
        if (!(index in value)) {
          return inertError("expected an inert value", itemPath)
        }

        const error = validateInertValue(value[index], itemPath, seen)
        if (error !== undefined) {
          return error
        }
      }
    } finally {
      seen.delete(value)
    }

    return undefined
  }

  if (isRecordObject(value)) {
    if (seen.has(value)) {
      return inertError("inert values must not contain cycles", path)
    }

    // `seen` is the active recursion stack. Remove the record on exit so
    // repeated references are allowed while true cycles are still rejected.
    seen.add(value)
    try {
      for (const [key, item] of Object.entries(value)) {
        const error = validateInertValue(item, joinPath(path, key), seen)

        if (error !== undefined) {
          return error
        }
      }
    } finally {
      seen.delete(value)
    }

    return undefined
  }

  return inertError("expected an inert value", path)
}

function cloneValidatedInertValue(value: InertValue): InertValue {
  if (Array.isArray(value)) {
    return value.map((item) => cloneValidatedInertValue(item))
  }

  // Even after validation, use the same plain-record predicate for cloning so
  // runtime branching stays aligned with the inert value invariant.
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
