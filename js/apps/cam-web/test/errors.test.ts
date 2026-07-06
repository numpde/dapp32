import assert from "node:assert/strict"
import test from "node:test"

import { errorMessage } from "../src/errors.ts"

test("errorMessage stops at cyclic cause chains", () => {
  const error = new Error("top")
  error.cause = error

  assert.equal(errorMessage(error), "top")
})

test("errorMessage still includes useful nested revert details", () => {
  const error = new Error("transaction failed", {
    cause: {
      data: {
        errorName: "Unauthorized",
        args: ["0x0000000000000000000000000000000000000001"],
      },
    },
  })

  assert.equal(
    errorMessage(error),
    'transaction failed: Unauthorized("0x0000000000000000000000000000000000000001")',
  )
})

test("errorMessage ignores provider objects with hostile property access", () => {
  const error = new Error("transaction failed", {
    cause: new Proxy({}, {
      has() {
        throw new Error("has trap failed")
      },
    }),
  })

  assert.equal(errorMessage(error), "transaction failed")
})

test("errorMessage keeps custom revert names when args are cyclic", () => {
  const cyclic: unknown[] = []
  cyclic.push(cyclic)
  const error = new Error("transaction failed", {
    cause: {
      data: {
        errorName: "BadArgs",
        args: [cyclic],
      },
    },
  })

  assert.equal(errorMessage(error), "transaction failed: BadArgs()")
})

test("errorMessage bounds untrusted provider text", () => {
  const long = "x".repeat(1_000)

  assert.equal(errorMessage(new Error(long)), `${"x".repeat(500)}...`)
  assert.equal(
    errorMessage(new Error("transaction failed", {
      cause: {
        data: {
          errorName: "BadArgs",
          args: [long],
        },
      },
    })),
    `transaction failed: ${`BadArgs("${long}")`.slice(0, 500)}...`,
  )

  assert.equal(
    errorMessage(new Error("transaction failed", {
      cause: {
        data: {
          errorName: "ManyArgs",
          args: Array.from({ length: 200 }, (_, index) => index),
        },
      },
    })),
    `transaction failed: ${`ManyArgs(${Array.from({ length: 200 }, (_, index) => index).join(", ")})`.slice(0, 500)}...`,
  )
})
