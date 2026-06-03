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
