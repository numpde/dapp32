import {
  isRecordObject,
  joinPath,
} from "@cam/protocol"
import { ScreenError } from "./errors.ts"

export {
  createStringMap,
  hasOwn,
  isRecordObject,
  joinPath,
} from "@cam/protocol"

export function requiredRecord(value: unknown, path: string): Record<string, unknown> {
  if (!isRecordObject(value)) {
    // The root path is represented as absent in public errors. Nested paths
    // stay explicit so parser failures remain local.
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

  for (let index = 0; index < value.length; index++) {
    if (!(index in value)) {
      throw new ScreenError("SCREEN_INVALID_FIELD", "expected a JSON value", joinPath(path, String(index)))
    }
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
