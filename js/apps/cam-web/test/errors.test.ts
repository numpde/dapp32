import assert from "node:assert/strict"
import test from "node:test"
import { CamEvmError, validateCamContractCall } from "@cam/evm-viem"

import { actionErrorMessage, errorMessage } from "../src/errors.ts"

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

test("errorMessage includes known browser fetch causes without exposing arbitrary cause text", () => {
  const url = "https://example.test/cam/main.json"
  const failure = Object.assign(new Error(`failed to load CAM resource ${url}`, {
    cause: new TypeError("Failed to execute 'fetch' on 'Window': Illegal invocation"),
  }), { code: "CAM_RESOURCE_LOAD_FAILED" })

  assert.equal(errorMessage(failure), `failed to load CAM resource ${url}: Failed to execute 'fetch' on 'Window': Illegal invocation`)
  assert.equal(
    errorMessage(Object.assign(new Error(`failed to load CAM resource ${url}`, {
      cause: new TypeError("Failed to fetch"),
    }), { code: "CAM_RESOURCE_LOAD_FAILED" })),
    `failed to load CAM resource ${url}: Failed to fetch`,
  )
  const privateCause = Object.assign(new TypeError("fetch failed for https://private.example/?token=secret"), {
    reason: "https://private.example/?token=secret",
    details: "https://private.example/?token=secret",
    shortMessage: "https://private.example/?token=secret",
  })
  assert.equal(
    errorMessage(Object.assign(new Error(`failed to load CAM resource ${url}`, {
      cause: privateCause,
    }), { code: "CAM_RESOURCE_LOAD_FAILED" })),
    `failed to load CAM resource ${url}`,
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

test("errorMessage survives hostile provider stringification", () => {
  const hostile = {
    toString() {
      throw new Error("hostile toString")
    },
  }

  assert.equal(errorMessage(hostile), "unprintable error")
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

test("errorMessage keeps custom revert names when args have hostile stringification", () => {
  const hostile = {
    toJSON() {
      throw new Error("hostile toJSON")
    },
    toString() {
      throw new Error("hostile toString")
    },
  }
  const error = new Error("transaction failed", {
    cause: {
      data: {
        errorName: "BadArgs",
        args: [hostile],
      },
    },
  })

  assert.equal(errorMessage(error), "transaction failed: BadArgs(unprintable value)")
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

test("action failures name the visible operation and retain the existing diagnostic once", () => {
  const cause = { data: { errorName: "ChannelNotFound", args: [999999n] } }
  const error = Object.assign(new Error("failed to call CAM route: position", { cause }), { code: "CAM_ROUTE_CALL_FAILED" })
  const diagnostic = errorMessage(error)
  assert.equal(actionErrorMessage(error, "Open balance"), `Open balance failed: ${diagnostic}`)
  assert.equal(actionErrorMessage(error, "Open balance").match(/ChannelNotFound\(999999\)/g)?.length, 1)
  assert.equal(error.cause, cause)
  assert.equal(error.code, "CAM_ROUTE_CALL_FAILED")
})

test("action failure labels use existing text bounds without coercing unsafe values", () => {
  const error = new Error("argument rejected")
  const hostile = { toString() { throw new Error("Do not stringify a label") } }
  for (const label of [undefined, null, hostile, "", "\u0000Open balance", "Open\n balance"]) {
    assert.equal(actionErrorMessage(error, label), "argument rejected")
  }
  assert.equal(actionErrorMessage(error, "x".repeat(1000)), `${"x".repeat(500)}... failed: argument rejected`)
  assert.equal(actionErrorMessage(error, "  Open balance  "), "Open balance failed: argument rejected")
})

test("a real rejected amount renders its action, one ABI path and correction without hiding the diagnostic", () => {
  assert.throws(() => validateCamContractCall({
    address: "0x0000000000000000000000000000000000000001",
    abi: [{ type: "function", name: "setWithdrawal", stateMutability: "nonpayable", inputs: [{ name: "amount", type: "uint256" }], outputs: [] }],
    function: "setWithdrawal", args: { amount: null },
  }), error => {
    assert(error instanceof CamEvmError)
    const visible = actionErrorMessage(error, "Review replacement request")
    assert(visible.startsWith("Review replacement request failed: "))
    assert(visible.includes(error.message), "the renderer preserves the substantive producer diagnostic")
    assert.equal(visible.split("setWithdrawal.amount").length - 1, 1)
    assert.match(visible, /whole number/)
    assert.match(visible, /uint256/)
    return true
  })
})
