import { ScreenError } from "./errors.ts"
import { createJsonGuards } from "@cam/protocol"

const GUARDS = createJsonGuards({
  error(kind, message, path) {
    return new ScreenError(kind === "notObject" ? "SCREEN_NOT_OBJECT" : "SCREEN_INVALID_FIELD", message, path)
  },
})

export const {
  rejectUnknownFields,
  requiredArray,
  requiredNonEmptyString,
  requiredRecord,
} = GUARDS
