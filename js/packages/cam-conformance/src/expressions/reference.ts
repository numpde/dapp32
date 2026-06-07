import {
  isExpressionIdentifier,
} from "@cam/protocol"

export type ExpressionReference = {
  readonly root: string
  readonly segments: readonly string[]
}

// Conformance checks inspect expression references without resolving them. The
// runtime parser still owns full expression validation; this helper only keeps
// authoring checks consistent when they ask "which root/name was referenced?".
export function expressionReference(value: string): ExpressionReference | undefined {
  if (!value.startsWith("$") || value.startsWith("$$")) return undefined

  const [root, ...segments] = value.slice(1).split(".")
  if (root === undefined || !isExpressionIdentifier(root)) {
    return { root: "", segments: [] }
  }

  return { root, segments }
}

export function expressionSyntaxError(value: string): string | undefined {
  if (!value.startsWith("$") || value.startsWith("$$")) return undefined

  const [root, ...segments] = value.slice(1).split(".")
  if (
    root === undefined
    || !isExpressionIdentifier(root)
    || segments.some((segment) => !isExpressionSegment(segment))
  ) {
    return `invalid expression syntax: ${value}`
  }

  return undefined
}

// Static strings are values conformance can reason about without runtime
// context. Escaped `$$foo` is static because runtime resolves it to `$foo`.
export function staticString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined
  if (expressionReference(value) !== undefined) return undefined
  return value.startsWith("$$") ? value.slice(1) : value
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

function isExpressionSegment(value: string): boolean {
  return isExpressionIdentifier(value) || isArrayIndex(value)
}

function isArrayIndex(value: string): boolean {
  return value === "0" || /^[1-9][0-9]*$/.test(value)
}
