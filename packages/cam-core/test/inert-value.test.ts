import assert from "node:assert/strict"
import test from "node:test"

import {
  CamError,
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

  const clone = toInertValue(value) as Record<string, unknown>
  assert.equal(clone.text, "ABC123")
  assert.equal(clone.count, 42)
  assert.equal(clone.enabled, true)
  assert.equal(clone.missing, null)
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
      assert.throws(
        () => toInertValue(value),
        (error) => error instanceof CamError
          && error.code === "CAM_INVALID_FIELD"
          && error.path === undefined,
      )
    })
  }
})

test("rejects nested non-inert values with a precise path", () => {
  assert.throws(
    () => toInertValue({ route: { params: [new Date(0)] } }),
    (error) => error instanceof CamError
      && error.code === "CAM_INVALID_FIELD"
      && error.path === "route.params.0",
  )
})

test("rejects cyclic arrays and records", () => {
  const cyclicRecord: Record<string, unknown> = {}
  cyclicRecord.self = cyclicRecord

  assert.throws(
    () => toInertValue(cyclicRecord),
    (error) => error instanceof CamError
      && error.code === "CAM_INVALID_FIELD"
      && error.path === "self",
  )

  const cyclicArray: unknown[] = []
  cyclicArray.push(cyclicArray)

  assert.throws(
    () => toInertValue(cyclicArray),
    (error) => error instanceof CamError
      && error.code === "CAM_INVALID_FIELD"
      && error.path === "0",
  )
})

test("accepts repeated references but rejects sparse arrays", () => {
  const shared = { value: "same data" }
  const clone = toInertValue({ left: shared, right: shared }) as Record<string, unknown>
  assert.deepEqual(clone.left, clone.right)

  const sparse = ["present", "missing"] as unknown[]
  delete sparse[1]

  assert.throws(
    () => toInertValue(sparse),
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

function withInertRejection(value: unknown, assertion: () => void): void {
  try {
    assertion()
  } catch (error) {
    throw new Error(`expected inert rejection for ${Object.prototype.toString.call(value)}`, { cause: error })
  }
}
