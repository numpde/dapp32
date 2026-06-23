export type NameListShapeIssue =
  | {
    readonly kind: "empty"
    readonly index: number
  }
  | {
    readonly kind: "duplicate"
    readonly name: string
    readonly index: number
  }

export function nameListShapeIssues(names: readonly string[]): readonly NameListShapeIssue[] {
  // Ordered name arrays are protocol handoff surfaces. Keep shape policy shared
  // while parsers and conformance rules retain their own paths and wording.
  const issues: NameListShapeIssue[] = []
  const seen = new Set<string>()

  for (const [index, name] of names.entries()) {
    if (name.length === 0) {
      issues.push({ kind: "empty", index })
      continue
    }
    if (seen.has(name)) {
      issues.push({ kind: "duplicate", name, index })
      continue
    }
    seen.add(name)
  }

  return issues
}

export function diffNameSets({
  expectedNames,
  actualNames,
  onMissing,
  onUnexpected,
}: {
  readonly expectedNames: readonly string[]
  readonly actualNames: readonly string[]
  readonly onMissing: (name: string) => void
  readonly onUnexpected: (name: string) => void
}): void {
  // Route, ABI, and UI handoffs are exact name-set contracts. Keep the diff
  // policy shared while each caller owns its path and error wording.
  const expected = new Set(expectedNames)
  const actual = new Set(actualNames)

  for (const name of actual) {
    if (!expected.has(name)) {
      onUnexpected(name)
    }
  }

  for (const name of expected) {
    if (!actual.has(name)) {
      onMissing(name)
    }
  }
}
