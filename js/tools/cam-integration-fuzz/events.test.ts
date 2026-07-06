import assert from "node:assert/strict"
import test from "node:test"

import { errorMessage } from "./events.ts"

test("errorMessage bounds integration fuzz event errors", () => {
  const long = "x".repeat(1_500)

  assert.equal(errorMessage(new Error(long)), `${"x".repeat(1_000)}...`)
  assert.equal(errorMessage(long), `${"x".repeat(1_000)}...`)
})
