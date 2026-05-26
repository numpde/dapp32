import assert from "node:assert/strict"
import test from "node:test"

import * as camProtocol from "../src/index.ts"
import {
  createExpressionRuntime,
  createStringMap,
} from "../src/index.ts"

test("keeps the public API to protocol support primitives", () => {
  assert.deepEqual(Object.keys(camProtocol).sort(), [
    "createExpressionRuntime",
    "createStringMap",
    "hasOwn",
    "isJsonScalar",
    "isRecordObject",
    "joinPath",
  ])
})

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

  const expected = createStringMap<unknown>()
  expected.owner = "0x0000000000000000000000000000000000000001"

  assert.deepEqual(
    runtime.resolveValue(
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
    ),
    expected,
  )
})

test("creates prototype-neutral string maps", () => {
  const map = createStringMap<string>()
  map.__proto__ = "data"

  assert.equal(Object.getPrototypeOf(map), null)
  assert.equal(map.__proto__, "data")
})
