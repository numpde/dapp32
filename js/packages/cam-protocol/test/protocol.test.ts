import assert from "node:assert/strict"
import test from "node:test"

import {
  createExpressionRuntime,
  InertValueError,
  toInertValue,
} from "../src/index.ts"

test("resolves expression payloads with caller-owned normalization and errors", () => {
  const runtime = createExpressionRuntime({
    roots: new Set(["values"]),
    numericSegments: true,
    normalize(value) {
      return value
    },
    error(_kind, message, path) {
      return new Error(path === undefined ? message : `${path}: ${message}`)
    },
  })

  const resolved = runtime.resolveValue(
    {
      owner: "$values.0.owner",
    },
    {
      values: [
        {
          owner: "0x0000000000000000000000000000000000000001",
        },
      ],
    },
    "field",
  ) as { readonly owner?: unknown }

  assert.equal(resolved.owner, "0x0000000000000000000000000000000000000001")
  assert.equal(runtime.resolveValue("$$values.0.owner", { values: [] }, "field"), "$values.0.owner")
})

test("validates, clones, and rejects non-inert protocol values", () => {
  const source = {
    nested: {
      value: "before",
    },
  }

  const clone = toInertValue(source) as Record<string, unknown>
  const nested = clone.nested as Record<string, unknown>

  assert.equal(Object.getPrototypeOf(clone), null)
  assert.equal(Object.getPrototypeOf(nested), null)

  source.nested.value = "after"
  assert.equal(nested.value, "before")
  assert.throws(
    () => toInertValue({ route: { params: [new Date(0)] } }),
    (error) => error instanceof InertValueError
      && error.path === "route.params.0",
  )
})
