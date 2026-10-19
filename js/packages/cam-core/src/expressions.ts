import { CamError } from "./errors.ts"
import {
  CAM_ROUTE_CONTEXT_KEYS,
  createExpressionRuntime,
} from "@cam/protocol"
import type { CamRuntimeContext, InertValue } from "@cam/protocol"
import { toInertCamValue } from "./guards.ts"

const CAM_EXPRESSIONS = createExpressionRuntime({
  roots: CAM_ROUTE_CONTEXT_KEYS,
  numericSegments: true,
  normalize: toInertCamValue,
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

export function resolveExpressionValue(
  value: InertValue,
  context: CamRuntimeContext,
  path: string,
): InertValue {
  return CAM_EXPRESSIONS.resolveValue(value, context, path)
}

export function parseExpressionPayload(value: unknown, path: string): InertValue {
  return CAM_EXPRESSIONS.parsePayload(value, path)
}
