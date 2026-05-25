import { ScreenError } from "./errors.ts"
import { isRecordObject, joinPath } from "@cam/core/internal/json"
export {
  cloneJsonValue,
  createStringMap,
  hasOwn,
  isRecordObject,
} from "@cam/core/internal/json"

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
