import assert from "node:assert/strict"
import test from "node:test"
import { ContractFunctionExecutionError, ContractFunctionRevertedError, HttpRequestError, sha256 } from "viem"
import { isRecordObject } from "@cam/protocol"
import { createCamViewerSession, viewerErrorMessage } from "@cam/viewer"
import { BIKE_ACCOUNT_ADDRESS, BIKE_CAM_URI, BIKE_UI_URI, bikeHost, bikeContractAddresses } from "../../../../tests/fixtures/cam/bike.mts"
import { bikeCamJson } from "../../../../tests/fixtures/cam/bike-resources.mts"
import { bikeResourceBytes, createMockCamPublicClient, createMockResourceLoader, encodeJson } from "../../../../tests/fixtures/cam/mock.mts"
import { CamEvmError, validateCamContractCall } from "@cam/evm-viem"

import { actionFailure, failureReport, UserFacingError } from "../src/errors.ts"

test("web failure reports render SDK prose without escaped layout whitespace or broken punctuation", () => {
  const reason = "The workshop permission expired. Ask the owner to renew it."
  const abi = [{ type: "function", name: "setAccountInfo", stateMutability: "nonpayable", inputs: [], outputs: [] }] as const
  const revert = new ContractFunctionRevertedError({ abi, functionName: "setAccountInfo", message: reason })
  const sdk = new ContractFunctionExecutionError(revert, { abi, functionName: "setAccountInfo" })
  const report = failureReport(new Error("The request was rejected.", { cause: sdk }), "Transaction not sent.")

  assert.match(report.diagnostic!, /setAccountInfo/)
  assert.match(report.diagnostic!, /reverted/)
  assert.equal(report.diagnostic!.split(reason).length - 1, 1)
  assert.doesNotMatch(report.diagnostic!, /\\u000[ad9]|\.:|:\s*:/)
  assert.match(report.diagnostic!, /The request was rejected\. The contract/)
  assert.match(viewerErrorMessage(sdk), /\\u000a/, "terminal callers retain control-safe escaped newlines")
})

test("web diagnostics normalize layout whitespace but preserve unsafe controls and distinct overlapping reasons", () => {
  const report = failureReport(new Error("Lookup failed.\r\nTry\tagain.", { cause: new Error("Lookup failed. The upstream returned an incomplete response.\u001b[2J") }))
  assert.match(report.diagnostic!, /Lookup failed\. Try again\./)
  assert.match(report.diagnostic!, /upstream returned an incomplete response/)
  assert.match(report.diagnostic!, /\\u001b\[2J/)
  assert.doesNotMatch(report.diagnostic!, /[\u0000-\u001f\u007f]|\\u000[ad9]|\.:/)
})

test("cause composition preserves distinct evidence and avoids extra punctuation after sentence endings", () => {
  for (const ending of [".", "?", "!", '."', ":"]) {
    const visible = viewerErrorMessage(new Error(`Provider rejected the request${ending}`, { cause: new Error("The account is locked.") }))
    assert(visible.includes(`${ending} The account`))
    assert.doesNotMatch(visible, /\.:|\?:|!:|::/)
  }
  assert.equal(viewerErrorMessage(new Error("Operation: setAccountInfo", { cause: new Error("Operation") })), "Operation: setAccountInfo: Operation")
  assert.equal(viewerErrorMessage(new Error("Same reason", { cause: new Error("Same reason") })), "Same reason")
})

test("web SDK failures retain safe reasons without flattened signed request evidence", () => {
  const cause = new HttpRequestError({ url: "https://example.test/rpc?api_key=fixture-api-key", body: { method: "eth_sendRawTransaction", params: ["fixture-private-signature"] }, details: "Connection closed.\nThe response was not received." })
  const report = failureReport(new Error("Cannot confirm submission.", { cause }))
  assert.match(report.diagnostic!, /HTTP request failed/)
  assert.match(report.diagnostic!, /Connection closed\. The response was not received\./)
  assert.doesNotMatch(JSON.stringify(report), /fixture-private-signature|fixture-api-key|Request body|\\\\u000a|\.:/)
})

test("structured provider diagnostics retain sanitized causes without serializing unrelated provider data", () => {
  const error = {
    message: "Local wallet submission failed.",
    data: {
      submission: "unknown",
      diagnostic: "Upstream disconnected.\nhttps://example.test/rpc?token=fixture-diagnostic-token \u001b[2J",
      rawTransaction: "fixture-private-signature",
    },
  }
  const report = failureReport(error)
  assert.match(report.diagnostic!, /Local wallet submission failed\. Upstream disconnected/)
  assert.match(report.diagnostic!, /example.test\/rpc/)
  assert.match(report.diagnostic!, /\\u001b/)
  assert.doesNotMatch(JSON.stringify(report), /fixture-diagnostic-token|fixture-private-signature|rawTransaction/)
})

test("viewerErrorMessage gives blank thrown values a readable diagnostic", () => {
  const emptyStringification = { toString: () => "" }

  for (const error of ["", "   ", " ".repeat(1_000), emptyStringification]) {
    assert.equal(viewerErrorMessage(error), "The error did not include a readable message.")
  }
  assert.equal(viewerErrorMessage("\n"), "\\u000a")
  assert.equal(viewerErrorMessage({ data: { errorName: "Reason", args: ["   "] } }), 'Reason("   ")')
})

test("viewerErrorMessage skips blank cause fragments and keeps useful causes", () => {
  assert.equal(viewerErrorMessage(new Error("operation failed", { cause: "   " })), "operation failed")
  assert.equal(viewerErrorMessage({ toString: () => "", cause: "cause explains failure" }), "cause explains failure")
})

test("viewerErrorMessage does not stringify an error when its readable message is present", () => {
  let stringifications = 0
  const error = {
    message: "readable failure",
    toString() {
      stringifications += 1
      return "fallback"
    },
  }

  assert.equal(viewerErrorMessage(error), "readable failure")
  assert.equal(stringifications, 0)
})

test("errorMessage stops at cyclic cause chains", () => {
  const error = new Error("top")
  error.cause = error

  assert.equal(viewerErrorMessage(error), "top")
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
    viewerErrorMessage(error),
    'transaction failed: Unauthorized("0x0000000000000000000000000000000000000001")',
  )
})

test("resource errors retain network reasons while redacting recognizable credentials", () => {
  const cause = new TypeError("DNS lookup failed for https://fixture-user:fixture-password@private.example/rpc?token=fixture-token&chain=31337\nAuthorization: Bearer fixture-bearer")
  const failure = Object.assign(new Error("failed to load CAM resource", { cause }), { code: "CAM_RESOURCE_LOAD_FAILED" })
  const visible = viewerErrorMessage(failure)
  assert.match(visible, /DNS lookup failed/)
  assert.match(visible, /private.example\/rpc/)
  assert.match(visible, /chain=31337/)
  assert.doesNotMatch(visible, /fixture-user|fixture-password|fixture-token|fixture-bearer/)
  assert.doesNotMatch(visible, /[\u0000-\u001f\u007f]/)
})

test("string causes remain visible with the same credential and control safeguards", () => {
  const visible = viewerErrorMessage(new Error("outer operation failed", { cause: "network disconnected\nhttps://example.test/rpc?token=fixture-string-token" }))
  assert.match(visible, /network disconnected/)
  assert.match(visible, /example.test\/rpc/)
  assert.doesNotMatch(visible, /fixture-string-token|[\u0000-\u001f\u007f]/)
})

test("URL evidence survives ordinary query addresses while encoded credential values are redacted", () => {
  const visible = viewerErrorMessage(new Error("request failed for https://example.test?email=user@example.test&%74oken=fixture-encoded-token"))
  assert.match(visible, /https:\/\/example.test\?email=user@example.test/)
  assert.doesNotMatch(visible, /fixture-encoded-token/)
})

test("hostile custom-revert argument access cannot replace the original failure", () => {
  const args = ["ordinary"]
  Object.defineProperty(args, "0", { get() { throw new Error("hostile argument getter") } })
  const visible = viewerErrorMessage(new Error("transaction failed", { cause: { data: { errorName: "BadArgs", args } } }))
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
    const visible = viewerErrorMessage(error)
    assert.match(visible, /failed to parse CAM UI resource/)
    assert.match(visible, /UnsupportedFixtureElement/)
    assert.match(visible, /nodes.app.element/)
    assert.equal(visible.split("UnsupportedFixtureElement").length - 1, 1)
    return true
  })
})

test("structured SDK diagnostics preserve the reason without exposing flattened request bodies", () => {
  const cause = new HttpRequestError({ url: "https://example.test/rpc?api_key=fixture-api-key", body: { method: "eth_sendRawTransaction", params: ["fixture-private-signature"] }, details: "upstream DNS resolution failed" })
  const visible = viewerErrorMessage(new Error("receipt checking failed", { cause }))
  assert.match(visible, /HTTP request failed/)
  assert.match(visible, /upstream DNS resolution failed/)
  assert.doesNotMatch(visible, /fixture-private-signature|fixture-api-key|Request body/)
})

test("fresh-object cause chains and combined diagnostics are bounded", () => {
  let reads = 0
  const fresh: object = { message: "nested diagnostic", get cause(): object | undefined { reads += 1; return reads < 128 ? Object.create(fresh) : undefined } }
  const visible = viewerErrorMessage(new Error("top", { cause: fresh }))
  assert.match(visible, /nested diagnostic/)
  assert(visible.length < 2100)
  assert(reads <= 32, "a fresh object per cause must not evade the chain bound")
  assert.match(viewerErrorMessage(new Error("top", { cause: new Error("x".repeat(3000)) })), /truncat|\.\.\./)
  let chain: unknown
  for (let index = 0; index < 10; index += 1) chain = new Error(`${index}: ${"x".repeat(400)}`, { cause: chain })
  const combined = viewerErrorMessage(chain)
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

  assert.equal(viewerErrorMessage(error), "transaction failed")
})

test("errorMessage survives hostile provider stringification", () => {
  const hostile = {
    toString() {
      throw new Error("hostile toString")
    },
  }

  assert.equal(viewerErrorMessage(hostile), "unprintable error")
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

  assert.equal(viewerErrorMessage(error), "transaction failed: BadArgs()")
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

  assert.equal(viewerErrorMessage(error), "transaction failed: BadArgs(unprintable value)")
})

test("errorMessage bounds untrusted provider text", () => {
  const long = "x".repeat(1_000)

  assert.equal(viewerErrorMessage(new Error(long)), `${"x".repeat(500)}...`)
  assert.equal(
    viewerErrorMessage(new Error("transaction failed", {
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
    viewerErrorMessage(new Error("transaction failed", {
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

test("custom revert diagnostics stop reading args after the visible prefix", () => {
  let indexedChecks = 0
  let indexedReads = 0
  const args = new Proxy(new Array(10_000), {
    has(target, property) {
      if (typeof property === "string" && /^\d+$/u.test(property)) indexedChecks += 1
      return Reflect.has(target, property) || (typeof property === "string" && /^\d+$/u.test(property))
    },
    get(target, property, receiver) {
      if (typeof property === "string" && /^\d+$/u.test(property)) {
        indexedReads += 1
        return Number(property)
      }
      return Reflect.get(target, property, receiver)
    },
  })
  const visible = viewerErrorMessage(new Error("transaction failed", {
    cause: { data: { errorName: "LargeArgs", args } },
  }))

  assert.match(visible, /^transaction failed: LargeArgs\(0, 1, 2,/)
  assert.match(visible, /\.\.\.$/)
  assert(indexedChecks < 1_000)
  assert(indexedReads < 1_000)
})

test("custom revert truncation marks omitted args when the visible prefix hits its exact budget", () => {
  const longArgument = "x".repeat(492)
  const nearLimitName = "N".repeat(498)

  const exactBudgetDiagnostic = viewerErrorMessage(new Error("transaction failed", {
    cause: { data: { errorName: "Edge", args: [longArgument, 42] } },
  }))
  assert.match(exactBudgetDiagnostic, /^transaction failed: Edge\("x+/)
  assert.match(exactBudgetDiagnostic, /\.\.\.$/)
  assert.match(
    viewerErrorMessage({ data: { errorName: nearLimitName, args: [42] } }),
    /N+\(4\.\.\.$/,
  )
  assert.match(
    viewerErrorMessage(new Error("transaction failed", { cause: { data: { errorName: "Edge", args: ["x".repeat(491), 42] } } })),
    /\.\.\.$/,
  )
})

test("custom revert formatting does not read an argument beyond the visible prefix", () => {
  const args = ["x".repeat(491)]
  Object.defineProperty(args, "1", { get() { throw new Error("invisible argument getter") } })
  args.length = 2

  const visible = viewerErrorMessage({ data: { errorName: "Edge", args } })
  assert.match(visible, /^Edge\("x+/)
  assert.match(visible, /\.\.\.$/)
  assert.doesNotMatch(visible, /unprintable arguments|invisible argument getter/)
})

test("custom revert diagnostics preserve sparse argument separators", () => {
  const args = new Array(3)
  args[2] = "visible"

  assert.equal(viewerErrorMessage({ data: { errorName: "Sparse", args } }), "Sparse(, , \"visible\")")
})

test("custom revert omission stays visible when composite credential redaction shortens the text", () => {
  const visible = viewerErrorMessage({
    data: {
      errorName: "https://",
      args: [`${"x".repeat(400)}@host`, "y".repeat(100), "omitted"],
    },
  })

  assert(visible.length < 500)
  assert.match(visible, /\.\.\.$/)
  assert.match(visible, /\[redacted\]/)
  assert.doesNotMatch(visible, /x{20}/)
  assert.doesNotMatch(visible, /omitted/)
})

test("action failures name the visible operation and retain the existing diagnostic once", () => {
  const cause = { data: { errorName: "ChannelNotFound", args: [999999n] } }
  const error = Object.assign(new Error("failed to call CAM route: position", { cause }), { code: "CAM_ROUTE_CALL_FAILED" })
  const diagnostic = viewerErrorMessage(error)
  const report = actionFailure(error, "Open balance")
  assert.match(report.message, /Open balance/)
  assert.doesNotMatch(report.message, /ChannelNotFound|CAM route/)
  assert.equal(report.diagnostic, diagnostic)
  assert.equal(report.diagnostic?.match(/ChannelNotFound\(999999\)/g)?.length, 1)
  assert.equal(error.cause, cause)
  assert.equal(error.code, "CAM_ROUTE_CALL_FAILED")
})

test("action failure labels use existing text bounds without coercing unsafe values", () => {
  const error = new Error("argument rejected")
  const hostile = { toString() { throw new Error("Do not stringify a label") } }
  for (const label of [undefined, null, hostile, "", "\u0000Open balance", "Open\n balance"]) {
    assert.equal(actionFailure(error, label).message, "Cannot complete this action.")
  }
  assert(actionFailure(error, "x".repeat(1000)).message.length < 550)
  assert.equal(actionFailure(error, "  Open balance  ").message, "Open balance failed.")
})

test("a real rejected amount renders its action, one ABI path and correction without hiding the diagnostic", () => {
  assert.throws(() => validateCamContractCall({
    address: "0x0000000000000000000000000000000000000001",
    abi: [{ type: "function", name: "setWithdrawal", stateMutability: "nonpayable", inputs: [{ name: "amount", type: "uint256" }], outputs: [] }],
    function: "setWithdrawal", args: { amount: null },
  }), error => {
    assert(error instanceof CamEvmError)
    const report = actionFailure(error, "Review replacement request")
    assert.match(report.message, /Review replacement request failed/)
    assert.doesNotMatch(report.message, /CAM ABI|uint256/)
    assert(report.diagnostic)
    assert(report.diagnostic.includes(error.message), "technical details preserve the substantive producer diagnostic")
    assert.equal(report.diagnostic.split("setWithdrawal.amount").length - 1, 1)
    assert.match(report.diagnostic, /whole number/)
    assert.match(report.diagnostic, /uint256/)
    return true
  })
})

test("UI failure reports separate owned explanations from arbitrary causes", () => {
  const error = new UserFacingError("Cannot read this document. Choose another file.", { cause: new TypeError("stream interrupted") })
  const report = failureReport(error)
  assert.equal(report.message, error.message)
  assert.equal(report.diagnostic, "stream interrupted", "the visible cause must not repeat the explanation")
  assert.match(report.diagnostic!, /stream interrupted/)
  assert.equal(failureReport(new UserFacingError("Choose a file.")).diagnostic, undefined)
  assert.equal(failureReport(new Error("ABI_INTERNAL"), "Cannot open this view.").message, "Cannot open this view.")
  assert.equal(failureReport(error, "Transaction confirmed; refreshing the view failed.").message, "Transaction confirmed; refreshing the view failed.")
})

test("owned summaries project their cause without depending on rendered punctuation", () => {
  for (const message of ["Cannot read this document; choose another file", "Cannot read this document.", "Cannot read this document:"]) {
    const error = new UserFacingError(message, { cause: new Error("stream interrupted") })
    assert.deepEqual(failureReport(error), { message, diagnostic: "stream interrupted" })
    assert.deepEqual(failureReport(error, message), { message, diagnostic: "stream interrupted" })
    assert.deepEqual(failureReport(new UserFacingError(message)), { message })
  }
  const error = new Error("Cannot read this document; choose another file", { cause: new Error("stream interrupted") })
  assert.equal(failureReport(error, error.message).diagnostic, viewerErrorMessage(error), "an explicit explanation does not authorize removing context from an arbitrary error")
  assert.deepEqual(failureReport(new Error("Cannot read this document."), "Cannot read this document."), { message: "Cannot read this document." })
})

test("hostile owned-error cause access cannot replace the safe operation diagnostic", () => {
  const error = new UserFacingError("Cannot read this document.")
  Object.defineProperty(error, "cause", { get() { throw new Error("hostile cause accessor") } })
  const report = failureReport(error)
  assert.equal(report.message, error.message)
  assert.equal(report.diagnostic, undefined)
  assert.doesNotMatch(JSON.stringify(report), /hostile cause accessor/)
})

test("UI summaries and details share credential redaction and text bounds", () => {
  const secretURL = "https://person:fixture-password@example.test/?token=fixture-token"
  const report = failureReport(new UserFacingError(`Cannot load ${secretURL}`, { cause: new Error("x".repeat(3000)) }))
  assert.doesNotMatch(JSON.stringify(report), /fixture-password|fixture-token/)
  assert(report.message.length < 550)
  assert(report.diagnostic!.length < 2100)
  for (const error of [null, "socket disconnected", new Proxy({}, { get() { throw new Error("hostile") } })]) {
    const unknown = failureReport(error, "Cannot refresh this view.")
    assert.equal(unknown.message, "Cannot refresh this view.")
    assert.equal(typeof unknown.diagnostic, "string")
  }
  const hostilePrototype = new Proxy({}, { getPrototypeOf() { throw new Error("hostile prototype") } })
  assert.equal(failureReport(hostilePrototype).message, "Cannot complete this operation.")
})
