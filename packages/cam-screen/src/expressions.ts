import { toInertValue } from "@cam/core"
import { SCREEN_CONTEXT_KEYS } from "./constants.ts"
import { ScreenError } from "./errors.ts"
import { hasOwn, isRecordObject, joinPath } from "./guards.ts"
import type { ScreenRuntimeContext } from "./types.ts"
import type { InertValue } from "@cam/core"

const EXPRESSION_RE = /^\$[A-Za-z][A-Za-z0-9_]*(\.(?:[A-Za-z][A-Za-z0-9_]*|0|[1-9][0-9]*))*$/

export function validateExpressionValue(value: unknown, path: string): void {
  // Expressions are encoded as inert strings, but their "$..." grammar still
  // needs validation before the payload is normalized with toInertValue().
  if (typeof value === "string") {
    validateExpressionString(value, path)
    return
  }

  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index++) {
      const itemPath = `${path}.${index}`
      if (!(index in value)) {
        throw new ScreenError("SCREEN_INVALID_FIELD", "expected a JSON value", itemPath)
      }

      validateExpressionValue(value[index], itemPath)
    }
    return
  }

  if (isRecordObject(value)) {
    for (const [key, item] of Object.entries(value)) {
      validateExpressionValue(item, `${path}.${key}`)
    }
    return
  }

  validateJsonLiteral(value, path)
}

export function resolveValueAtPath(value: InertValue, context: ScreenRuntimeContext, path: string): InertValue {
  if (typeof value === "string") {
    return resolveString(value, context, path)
  }

  if (Array.isArray(value)) {
    return value.map((item, index) => resolveValueAtPath(item, context, joinPath(path, String(index))))
  }

  if (isRecordObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, resolveValueAtPath(item, context, joinPath(path, key))]),
    )
  }

  return value
}

function validateJsonLiteral(value: unknown, path: string): void {
  if (value === null || typeof value === "boolean") {
    return
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return
  }

  throw new ScreenError("SCREEN_INVALID_FIELD", "expected a JSON value", path)
}

function resolveString(value: string, context: ScreenRuntimeContext, path: string): InertValue {
  // Only a leading "$" opts into screen expression resolution. Strings such
  // as "Price: $5" remain ordinary literals; malformed "$..." values fail
  // during validation instead of becoming implicit templates.
  if (!value.startsWith("$")) {
    return value
  }

  validateExpressionString(value, path)

  const segments = value.slice(1).split(".")
  let current: unknown = context[segments[0] as keyof ScreenRuntimeContext]

  for (const segment of segments.slice(1)) {
    current = readSegment(current, segment, value, path)
  }

  if (current === undefined) {
    throw new ScreenError("SCREEN_UNRESOLVED_VALUE", `unresolved expression: ${value}`, path)
  }

  return toInertValue(current)
}

function readSegment(source: unknown, segment: string, expression: string, path: string): unknown {
  if (Array.isArray(source) && isArrayIndex(segment)) {
    return source[Number(segment)]
  }

  if (isRecordObject(source) && hasOwn(source, segment)) {
    return source[segment]
  }

  throw new ScreenError("SCREEN_UNRESOLVED_VALUE", `unresolved expression: ${expression}`, path)
}

function validateExpressionString(value: string, path: string): void {
  // Screen expressions intentionally share CAM's narrow variable-reference
  // model, with numeric path segments added only for route return values.
  if (!value.startsWith("$")) {
    return
  }

  if (!EXPRESSION_RE.test(value)) {
    throw new ScreenError("SCREEN_INVALID_EXPRESSION", `invalid expression syntax: ${value}`, path)
  }

  const root = value.slice(1).split(".", 1)[0]
  if (!SCREEN_CONTEXT_KEYS.has(root)) {
    throw new ScreenError("SCREEN_INVALID_EXPRESSION", `unknown expression root: ${root}`, path)
  }
}

function isArrayIndex(value: string): boolean {
  return value === "0" || /^[1-9][0-9]*$/.test(value)
}
