import assert from "node:assert/strict"
import test from "node:test"

import {
  createExpressionRuntime,
  InertValueError,
  readBoundedResponseBytes,
  requireHttpOrigin,
  requireHttpURL,
  requireSameHttpOrigin,
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

test("validates HTTP resource boundaries and bounded response bytes", async () => {
  assert.equal(requireHttpURL("https://example.test/cam/main.json", "uri").href, "https://example.test/cam/main.json")
  assert.equal(requireHttpOrigin("https://example.test", "origin"), "https://example.test")
  assert.equal(
    requireSameHttpOrigin("https://example.test/cam/ui.json", "https://example.test", "uri").pathname,
    "/cam/ui.json",
  )
  assert.throws(() => requireHttpURL("ftp://example.test/x", "uri"), /http/)
  assert.throws(() => requireHttpURL("https://user@example.test/x", "uri"), /credentials/)
  assert.throws(() => requireHttpOrigin("https://example.test/path", "origin"), /origin/)
  assert.throws(() => requireSameHttpOrigin("https://other.test/x", "https://example.test", "uri"), /outside/)

  const small = await readBoundedResponseBytes(new Response("abc", {
    headers: {
      "content-length": "3",
    },
  }), "https://example.test/x", 3)
  assert.equal(new TextDecoder().decode(small), "abc")

  await assert.rejects(
    () => readBoundedResponseBytes(new Response("abcd", {
      headers: {
        "content-length": "4",
      },
    }), "https://example.test/x", 3),
    /too large/,
  )
})
