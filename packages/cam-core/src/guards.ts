import { CamError } from "./errors.ts"
import { isRecordObject, joinPath } from "./internal/json.ts"
export {
  cloneJsonValue,
  createStringMap,
  hasOwn,
  isRecordObject,
} from "./internal/json.ts"

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
