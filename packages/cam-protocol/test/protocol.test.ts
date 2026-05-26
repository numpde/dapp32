import assert from "node:assert/strict"
import test from "node:test"

import * as camProtocol from "../src/index.ts"
import {
  createExpressionRuntime,
  createJsonGuards,
  createStringMap,
  InertValueError,
  parseJsonBytes,
  parseJsonText,
  toInertValue,
} from "../src/index.ts"

test("keeps the public API to protocol support primitives", () => {
  assert.deepEqual(Object.keys(camProtocol).sort(), [
    "InertValueError",
    "createExpressionRuntime",
    "createJsonGuards",
    "createStringMap",
    "hasOwn",
    "isNonStringJsonScalar",
    "isRecordObject",
    "joinPath",
    "parseJsonBytes",
    "parseJsonText",
    "toInertValue",
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

test("validates and clones inert protocol values", () => {
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
})

test("rejects non-inert protocol values with a precise path", () => {
  assert.throws(
    () => toInertValue({ route: { params: [new Date(0)] } }),
    (error) => error instanceof InertValueError
      && error.path === "route.params.0",
  )
})

test("parses JSON text", () => {
  assert.deepEqual(
    parseJsonText('{"ok":true}'),
    {
      ok: true,
    },
  )
})

test("parses UTF-8 JSON bytes", () => {
  assert.deepEqual(
    parseJsonBytes(new TextEncoder().encode('{"ok":true}')),
    {
      ok: true,
    },
  )
})
