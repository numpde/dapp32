import assert from "node:assert/strict"
import test from "node:test"

import { formatDisplayText, formatValue } from "../format.ts"

test("formatValue bounds human terminal display text", () => {
  const long = "x".repeat(2_500)

  assert.equal(formatValue(long), `${"x".repeat(2_000)}...`)
  assert.equal(formatValue({ text: long }), `${JSON.stringify({ text: long }).slice(0, 2_000)}...`)
  assert.equal(formatValue(BigInt(`1${"0".repeat(2_500)}`)), `${`1${"0".repeat(2_500)}`.slice(0, 2_000)}...`)
  assert.equal(formatDisplayText(long), `${"x".repeat(2_000)}...`)
})
