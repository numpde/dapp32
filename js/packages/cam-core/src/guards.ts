import { CamError } from "./errors.ts"
import { createJsonGuards, InertValueError, joinPath, toInertValue } from "@cam/protocol"
import type { InertValue } from "@cam/protocol"

const GUARDS = createJsonGuards({
  requireExplicitArrays: true,
  error(kind, message, path) {
    return new CamError(kind === "notObject" ? "CAM_NOT_OBJECT" : "CAM_INVALID_FIELD", message, path)
  },
})

export const {
  rejectUnknownFields,
  requiredArray,
  requiredNonEmptyString,
  requiredRecord,
} = GUARDS

export function toInertCamValue(value: unknown, path: string): InertValue {
  try {
    return toInertValue(value)
  } catch (error) {
    if (error instanceof InertValueError) {
      throw new CamError(
        "CAM_INVALID_FIELD",
        error.message,
        error.path === undefined ? path : joinPath(path, error.path),
      )
    }

    throw error
  }
}
