const IDENTIFIER_RE = /^[A-Za-z][A-Za-z0-9_]*$/

export type ExpressionReference = {
  readonly root: string
  readonly firstSegment?: string
}

// Conformance checks inspect expression references without resolving them. The
// runtime parser still owns full expression validation; this helper only keeps
// authoring checks consistent when they ask "which root/name was referenced?".
export function expressionReference(value: string): ExpressionReference | undefined {
  if (!value.startsWith("$") || value.startsWith("$$")) return undefined

  const [root, firstSegment] = value.slice(1).split(".")
  if (root === undefined || !IDENTIFIER_RE.test(root)) {
    return { root: "" }
  }
  if (firstSegment !== undefined && !IDENTIFIER_RE.test(firstSegment)) {
    return { root, firstSegment: "" }
  }

  return { root, firstSegment }
}
