import assert from "node:assert/strict"
import test from "node:test"

import * as camProtocol from "../src/index.ts"
import {
  createExpressionRuntime,
  createJsonGuards,
  createStringMap,
  parseJsonText,
} from "../src/index.ts"

test("keeps the public API to protocol support primitives", () => {
  assert.deepEqual(Object.keys(camProtocol).sort(), [
    "createExpressionRuntime",
    "createJsonGuards",
    "createStringMap",
    "hasOwn",
    "isNonStringJsonScalar",
    "isRecordObject",
    "joinPath",
    "parseJsonText",
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

test("creates parser guards with caller-owned error policy", () => {
  const guards = createJsonGuards({
    requireExplicitArrays: true,
    error(kind, message, path) {
      return new Error(`${kind}:${path ?? ""}:${message}`)
    },
  })

  assert.throws(
    () => guards.requiredArray(undefined, "routes.entry.args"),
    /invalidField:routes\.entry\.args:expected an explicit array/,
  )

  assert.throws(
    () => guards.requiredRecord(null, ""),
    /notObject::expected an object/,
  )
})

test("creates prototype-neutral string maps", () => {
  const map = createStringMap<string>()
  map.__proto__ = "data"

  assert.equal(Object.getPrototypeOf(map), null)
  assert.equal(map.__proto__, "data")
})

test("parses JSON text", () => {
  assert.deepEqual(
    parseJsonText('{"ok":true}'),
    {
      ok: true,
    },
  )
})
