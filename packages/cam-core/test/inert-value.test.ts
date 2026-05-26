import assert from "node:assert/strict"
import test from "node:test"

import {
  CamError,
  assertInertValue,
  cloneInertValue,
  isInertValue,
  toInertValue,
} from "../src/index.ts"

test("accepts inert scalar, array, and record values", () => {
  const value = {
    text: "ABC123",
    count: 42,
    enabled: true,
    missing: null,
    nested: [
      "owner",
      {
        address: "0x0000000000000000000000000000000000000001",
      },
    ],
  }

  assert.equal(isInertValue(value), true)
  assert.doesNotThrow(() => assertInertValue(value))
})

test("rejects values with behavior, host identity, or non-JSON scalar semantics", () => {
  for (const value of [
    undefined,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    BigInt(1),
    Symbol("x"),
    () => undefined,
    new Date(0),
    new Map(),
    new Set(),
    new Uint8Array(),
    Object.create({ inherited: true }),
  ]) {
    withInertRejection(value, () => {
      assert.equal(isInertValue(value), false)
      assert.throws(
        () => assertInertValue(value),
        (error) => error instanceof CamError
          && error.code === "CAM_INVALID_FIELD"
          && error.path === undefined,
      )
    })
  }
})

test("rejects nested non-inert values with a precise path", () => {
  assert.throws(
    () => assertInertValue({ route: { params: [new Date(0)] } }),
    (error) => error instanceof CamError
      && error.code === "CAM_INVALID_FIELD"
      && error.path === "route.params.0",
  )
})

test("rejects cyclic arrays and records", () => {
  const cyclicRecord: Record<string, unknown> = {}
  cyclicRecord.self = cyclicRecord

  assert.equal(isInertValue(cyclicRecord), false)
  assert.throws(
    () => assertInertValue(cyclicRecord),
    (error) => error instanceof CamError
      && error.code === "CAM_INVALID_FIELD"
      && error.path === "self",
  )

  const cyclicArray: unknown[] = []
  cyclicArray.push(cyclicArray)

  assert.equal(isInertValue(cyclicArray), false)
  assert.throws(
    () => assertInertValue(cyclicArray),
    (error) => error instanceof CamError
      && error.code === "CAM_INVALID_FIELD"
      && error.path === "0",
  )
})

test("accepts repeated references but rejects sparse arrays", () => {
  const shared = { value: "same data" }
  assert.equal(isInertValue({ left: shared, right: shared }), true)

  const sparse = ["present", "missing"] as unknown[]
  delete sparse[1]

  assert.equal(isInertValue(sparse), false)
  assert.throws(
    () => assertInertValue(sparse),
    (error) => error instanceof CamError
      && error.code === "CAM_INVALID_FIELD"
      && error.path === "1",
  )
})

test("toInertValue validates unknown input and returns an isolated prototype-neutral copy", () => {
  const source = {
    nested: {
      value: "before",
    },
    list: [
      {
        item: 1,
      },
    ],
  }

  const clone = toInertValue(source)
  assert.equal(isInertValue(clone), true)
  assert.equal(Object.getPrototypeOf(clone), null)

  const cloneRecord = clone as Record<string, unknown>
  const nested = cloneRecord.nested as Record<string, unknown>
  const list = cloneRecord.list as unknown[]
  const item = list[0] as Record<string, unknown>

  assert.equal(Object.getPrototypeOf(nested), null)
  assert.equal(Object.getPrototypeOf(item), null)

  source.nested.value = "after"
  assert.equal(nested.value, "before")

  nested.value = "clone mutation"
  assert.equal(source.nested.value, "after")
})

test("toInertValue rejects unsupported input instead of returning live references", () => {
  assert.throws(
    () => toInertValue({ date: new Date(0) }),
    (error) => error instanceof CamError
      && error.code === "CAM_INVALID_FIELD"
      && error.path === "date",
  )
})

test("cloneInertValue clones already-valid inert values", () => {
  const source = toInertValue({
    nested: {
      value: "before",
    },
  })
  const clone = cloneInertValue(source)

  const sourceRecord = source as Record<string, unknown>
  const cloneRecord = clone as Record<string, unknown>
  const sourceNested = sourceRecord.nested as Record<string, unknown>
  const cloneNested = cloneRecord.nested as Record<string, unknown>

  assert.notEqual(clone, source)
  assert.notEqual(cloneNested, sourceNested)
  assert.equal(cloneNested.value, "before")
})

function withInertRejection(value: unknown, assertion: () => void): void {
  try {
    assertion()
  } catch (error) {
    throw new Error(`expected inert rejection for ${Object.prototype.toString.call(value)}`, { cause: error })
  }
}
