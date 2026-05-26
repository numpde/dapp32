import { CamError } from "./errors.ts"
import { createJsonGuards } from "@cam/protocol"

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
