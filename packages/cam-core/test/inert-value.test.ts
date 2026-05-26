import assert from "node:assert/strict"
import test from "node:test"

import {
  CamError,
  toInertValue,
} from "../src/index.ts"

test("toInertValue remains the CAM-shaped wrapper for inert protocol values", () => {
  const source = {
    nested: {
      value: "before",
    },
  }

  const clone = toInertValue(source) as Record<string, unknown>
  const nested = clone.nested as Record<string, unknown>

  assert.equal(Object.getPrototypeOf(clone), null)
  source.nested.value = "after"
  assert.equal(nested.value, "before")
})

test("toInertValue maps protocol inert failures to CamError", () => {
  assert.throws(
    () => toInertValue({ route: { params: [new Date(0)] } }),
    (error) => error instanceof CamError
      && error.code === "CAM_INVALID_FIELD"
      && error.path === "route.params.0",
  )
})
