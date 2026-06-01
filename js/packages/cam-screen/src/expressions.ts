import {
  createExpressionRuntime,
  InertValueError,
  joinPath,
  toInertValue,
} from "@cam/protocol"
import { UI_CONTEXT_KEYS } from "./constants.ts"
import { UiError } from "./errors.ts"
import type { UiRuntimeContext } from "./types.ts"
import type { InertValue } from "@cam/protocol"

const UI_EXPRESSIONS = createExpressionRuntime({
  roots: UI_CONTEXT_KEYS,
  numericSegments: true,
  normalize(value, path) {
    try {
      return toInertValue(value)
    } catch (error) {
      if (error instanceof InertValueError) {
        throw new UiError(
          "UI_INVALID_FIELD",
          error.message,
          error.path === undefined ? path : joinPath(path, error.path),
        )
      }

      throw error
    }
  },
  error(kind, message, path) {
    switch (kind) {
      case "invalidField":
        return new UiError("UI_INVALID_FIELD", message, path)
      case "invalidExpression":
        return new UiError("UI_INVALID_EXPRESSION", message, path)
      case "unresolvedValue":
        return new UiError("UI_UNRESOLVED_VALUE", message, path)
    }
  },
})

export function validateExpressionValue(value: unknown, path: string): void {
  UI_EXPRESSIONS.validateValue(value, path)
}

export function parseExpressionPayload(value: unknown, path: string): InertValue {
  return UI_EXPRESSIONS.parsePayload(value, path)
}

export function resolveValueAtPath(value: InertValue, context: UiRuntimeContext, path: string): InertValue {
  return UI_EXPRESSIONS.resolveValue(value, context, path)
}
