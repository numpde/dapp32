import assert from "node:assert/strict"
import test from "node:test"

import { errorMessage } from "./events.ts"

test("errorMessage bounds integration fuzz event errors", () => {
  const long = "x".repeat(1_500)

  assert.match(errorMessage(new Error(long)), /^x+\.\.\.$/)
  assert.match(errorMessage(long), /^x+\.\.\.$/)
  assert(errorMessage(new Error(long)).length <= 1_003)
  assert(errorMessage(long).length <= 1_003)
})

test("errorMessage survives hostile thrown values", () => {
  const hostile = {
    toString() {
      throw new Error("stringification failed")
    },
  }

  assert.match(errorMessage(hostile), /unprintable/)
})

test("fuzz errors retain causal diagnostics rather than only the wrapper", () => {
  const cause = Object.assign(new Error("execution reverted"), { data: { errorName: "UnknownResource", args: [42n] } })
  const visible = errorMessage(new Error("read failed", { cause }))
  assert.match(visible, /read failed/)
  assert.match(visible, /UnknownResource\(42\)/)
})
