import { CAM_CONTEXT_KEYS } from "./constants.ts"
import { CamError } from "./errors.ts"
import {
  createExpressionRuntime,
  InertValueError,
  joinPath,
  toInertValue,
} from "@cam/protocol"
import type { CamRuntimeContext } from "./types.ts"
import type { InertValue } from "@cam/protocol"

const CAM_EXPRESSIONS = createExpressionRuntime({
  roots: CAM_CONTEXT_KEYS,
  numericSegments: true,
  normalize(value, path) {
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
  },
  error(kind, message, path) {
    switch (kind) {
      case "invalidField":
        return new CamError("CAM_INVALID_FIELD", message, path)
      case "invalidExpression":
        return new CamError("CAM_INVALID_EXPRESSION", message, path)
      case "unresolvedValue":
        return new CamError("CAM_UNRESOLVED_VALUE", message, path)
    }
  },
})

export function resolveArgs(
  args: Record<string, InertValue>,
  context: CamRuntimeContext,
): Record<string, InertValue> {
  const resolved: Record<string, InertValue> = Object.create(null) as Record<string, InertValue>

  for (const [name, value] of Object.entries(args)) {
    resolved[name] = CAM_EXPRESSIONS.resolveValue(value, context, `args.${name}`)
  }

  return resolved
}

export function validateExpressionValue(value: unknown, path: string): void {
  CAM_EXPRESSIONS.validateValue(value, path)
}

export function parseExpressionPayload(value: unknown, path: string): InertValue {
  return CAM_EXPRESSIONS.parsePayload(value, path)
}
