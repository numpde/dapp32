import {
  expressionReferenceSyntaxError,
  parseExpressionReference,
  parseStaticExpressionString,
} from "@cam/protocol"
import type {
  ExpressionReference,
} from "@cam/protocol"

// Conformance only parses enough expression surface to prove static publication
// failures: malformed `$...` references, unsupported roots, and known names.
// Runtime remains responsible for full expression semantics and resolution.
export function expressionReference(value: string): ExpressionReference | undefined {
  return parseExpressionReference(value, { numericSegments: true })
}

export function expressionSyntaxError(value: string): string | undefined {
  return expressionReferenceSyntaxError(value, { numericSegments: true })
}

// Static strings are values conformance can reason about without a dynamic
// context. Escaped `$$foo` is data whose interpreted value starts with `$`.
export function staticString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined
  return parseStaticExpressionString(value)
}

export function staticStringList(value: unknown): readonly string[] | undefined {
  if (Array.isArray(value)) {
    const result: string[] = []
    for (const item of value) {
      const staticItem = staticString(item)
      if (staticItem === undefined) return undefined
      result.push(staticItem)
    }

    return result
  }

  const staticValue = staticString(value)
  return staticValue === undefined ? undefined : [staticValue]
}
