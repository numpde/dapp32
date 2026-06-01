import { UiError } from "./errors.ts"
import { createJsonGuards } from "@cam/protocol"

const GUARDS = createJsonGuards({
  error(kind, message, path) {
    return new UiError(kind === "notObject" ? "UI_NOT_OBJECT" : "UI_INVALID_FIELD", message, path)
  },
})

export const {
  rejectUnknownFields,
  requiredArray,
  requiredNonEmptyString,
  requiredRecord,
} = GUARDS
