import { CamError } from "./errors.ts"
import {
  InertValueError,
  toInertValue as toProtocolInertValue,
} from "@cam/protocol"
import type { InertRecord, InertValue } from "@cam/protocol"

export type {
  InertRecord,
  InertValue,
} from "@cam/protocol"

export function toInertValue(value: unknown): InertValue {
  try {
    return toProtocolInertValue(value)
  } catch (error) {
    if (error instanceof InertValueError) {
      throw new CamError("CAM_INVALID_FIELD", error.message, error.path)
    }

    throw error
  }
}
