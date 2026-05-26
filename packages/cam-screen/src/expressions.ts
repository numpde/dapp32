import { createExpressionRuntime, joinPath } from "@cam/protocol"
import { CamError, toInertValue } from "@cam/core"
import { SCREEN_CONTEXT_KEYS } from "./constants.ts"
import { ScreenError } from "./errors.ts"
import type { ScreenRuntimeContext } from "./types.ts"
import type { InertValue } from "@cam/core"

const SCREEN_EXPRESSIONS = createExpressionRuntime({
  roots: SCREEN_CONTEXT_KEYS,
  numericSegments: true,
  normalize(value, path) {
    try {
      return toInertValue(value)
    } catch (error) {
      if (error instanceof CamError) {
        throw new ScreenError(
          "SCREEN_INVALID_FIELD",
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
        return new ScreenError("SCREEN_INVALID_FIELD", message, path)
      case "invalidExpression":
        return new ScreenError("SCREEN_INVALID_EXPRESSION", message, path)
      case "unresolvedValue":
        return new ScreenError("SCREEN_UNRESOLVED_VALUE", message, path)
    }
  },
})

export function validateExpressionValue(value: unknown, path: string): void {
  SCREEN_EXPRESSIONS.validateValue(value, path)
}

export function parseExpressionPayload(value: unknown, path: string): InertValue {
  return SCREEN_EXPRESSIONS.parsePayload(value, path)
}

export function resolveValueAtPath(value: InertValue, context: ScreenRuntimeContext, path: string): InertValue {
  return SCREEN_EXPRESSIONS.resolveValue(value, context as unknown as Record<string, unknown>, path)
}
