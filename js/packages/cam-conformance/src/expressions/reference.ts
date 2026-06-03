const IDENTIFIER_RE = /^[A-Za-z][A-Za-z0-9_]*$/

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
  if (root === undefined || !IDENTIFIER_RE.test(root)) {
    return { root: "", segments: [] }
  }

  return { root, segments }
}

export function isExpressionIdentifier(value: string): boolean {
  return IDENTIFIER_RE.test(value)
}
