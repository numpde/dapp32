import assert from "node:assert/strict"
import test from "node:test"
import { HttpRequestError, sha256 } from "viem"
import { isRecordObject } from "@cam/protocol"
import { createCamViewerSession } from "@cam/viewer"
import { BIKE_ACCOUNT_ADDRESS, BIKE_CAM_URI, BIKE_UI_URI, bikeHost, bikeContractAddresses } from "../../../../tests/fixtures/cam/bike.mts"
import { bikeCamJson } from "../../../../tests/fixtures/cam/bike-resources.mts"
import { bikeResourceBytes, createMockCamPublicClient, createMockResourceLoader, encodeJson } from "../../../../tests/fixtures/cam/mock.mts"
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

test("resource errors retain network reasons while redacting recognizable credentials", () => {
  const cause = new TypeError("DNS lookup failed for https://fixture-user:fixture-password@private.example/rpc?token=fixture-token&chain=31337\nAuthorization: Bearer fixture-bearer")
  const failure = Object.assign(new Error("failed to load CAM resource", { cause }), { code: "CAM_RESOURCE_LOAD_FAILED" })
  const visible = errorMessage(failure)
  assert.match(visible, /DNS lookup failed/)
  assert.match(visible, /private.example\/rpc/)
  assert.match(visible, /chain=31337/)
  assert.doesNotMatch(visible, /fixture-user|fixture-password|fixture-token|fixture-bearer/)
  assert.doesNotMatch(visible, /[\u0000-\u001f\u007f]/)
})

test("string causes remain visible with the same credential and control safeguards", () => {
  const visible = errorMessage(new Error("outer operation failed", { cause: "network disconnected\nhttps://example.test/rpc?token=fixture-string-token" }))
  assert.match(visible, /network disconnected/)
  assert.match(visible, /example.test\/rpc/)
  assert.doesNotMatch(visible, /fixture-string-token|[\u0000-\u001f\u007f]/)
})

test("URL evidence survives ordinary query addresses while encoded credential values are redacted", () => {
  const visible = errorMessage(new Error("request failed for https://example.test?email=user@example.test&%74oken=fixture-encoded-token"))
  assert.match(visible, /https:\/\/example.test\?email=user@example.test/)
  assert.doesNotMatch(visible, /fixture-encoded-token/)
})

test("hostile custom-revert argument access cannot replace the original failure", () => {
  const args = ["ordinary"]
  Object.defineProperty(args, "0", { get() { throw new Error("hostile argument getter") } })
  const visible = errorMessage(new Error("transaction failed", { cause: { data: { errorName: "BadArgs", args } } }))
  assert.match(visible, /transaction failed/)
  assert.match(visible, /BadArgs\(/)
  assert.match(visible, /unprintable/i)
  assert.doesNotMatch(visible, /hostile argument getter/)
})

test("a real failed UI load exposes its parse cause through the web consumer", async () => {
  const bytes = encodeJson({ ui: "1.0.0", nodes: { app: { element: "UnsupportedFixtureElement" } } })
  const cam = structuredClone(bikeCamJson)
  assert(isRecordObject(cam.namespaces))
  assert(isRecordObject(cam.namespaces.ui))
  cam.namespaces.ui.integrity = `sha256:${sha256(bytes)}`
  const camBytes = encodeJson(cam)
  const session = createCamViewerSession({
    host: bikeHost, account: { address: BIKE_ACCOUNT_ADDRESS }, inputs: {},
    publicClient: createMockCamPublicClient({ chainId: 31337, camURI: BIKE_CAM_URI, camHash: sha256(camBytes), supportsCamInterface: true, addresses: bikeContractAddresses, routeResults: {} }),
    loadResource: createMockResourceLoader(bikeResourceBytes({ [BIKE_CAM_URI]: camBytes, [BIKE_UI_URI]: bytes })),
  })
  await assert.rejects(() => session.load(), error => {
    const visible = errorMessage(error)
    assert.match(visible, /failed to parse CAM UI resource/)
    assert.match(visible, /UnsupportedFixtureElement/)
    assert.match(visible, /nodes.app.element/)
    assert.equal(visible.split("UnsupportedFixtureElement").length - 1, 1)
    return true
  })
})

test("structured SDK diagnostics preserve the reason without exposing flattened request bodies", () => {
  const cause = new HttpRequestError({ url: "https://example.test/rpc?api_key=fixture-api-key", body: { method: "eth_sendRawTransaction", params: ["fixture-private-signature"] }, details: "upstream DNS resolution failed" })
  const visible = errorMessage(new Error("receipt checking failed", { cause }))
  assert.match(visible, /HTTP request failed/)
  assert.match(visible, /upstream DNS resolution failed/)
  assert.doesNotMatch(visible, /fixture-private-signature|fixture-api-key|Request body/)
})

test("fresh-object cause chains and combined diagnostics are bounded", () => {
  let reads = 0
  const fresh: object = { message: "nested diagnostic", get cause(): object | undefined { reads += 1; return reads < 128 ? Object.create(fresh) : undefined } }
  const visible = errorMessage(new Error("top", { cause: fresh }))
  assert.match(visible, /nested diagnostic/)
  assert(visible.length < 2100)
  assert(reads <= 32, "a fresh object per cause must not evade the chain bound")
  assert.match(errorMessage(new Error("top", { cause: new Error("x".repeat(3000)) })), /truncat|\.\.\./)
  let chain: unknown
  for (let index = 0; index < 10; index += 1) chain = new Error(`${index}: ${"x".repeat(400)}`, { cause: chain })
  const combined = errorMessage(chain)
  assert(combined.length < 2100, "distinct individually bounded causes must also have a total display bound")
  assert(combined.endsWith("..."))
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
