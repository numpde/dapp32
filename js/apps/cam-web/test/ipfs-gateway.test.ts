import assert from "node:assert/strict"
import test from "node:test"
import { assertDownloadAllowed, CAM_RESOURCE_MAX_BYTES } from "@cam/protocol"

import { defaultIpfsGateway, publicIpfsGateways } from "@cam/viewer"
import { createViewerResourceLoader } from "../src/startup.ts"
import { checkIpfsGateway, IPFS_GATEWAY_TEST_URI } from "../src/gateway-check.ts"
import { RESOURCE_FETCH_OPTIONS } from "../src/resource-read.ts"

test("ordinary downloads exclude retired HTTP gateways and use the public file gateway by default", async t => {
  assert(!publicIpfsGateways.some(gateway => ["ipfs-io", "dweb-link"].includes(gateway.id)))
  const cid = "QmT78zSuBmuS4z925WZfrqQ1qHaJ56DQaTfyMUF7F8ff5o"
  const bytes = new TextEncoder().encode("hello world\n")
  const fetch = t.mock.method(globalThis, "fetch", async () => new Response(bytes))
  const loader = createViewerResourceLoader(uri => assertDownloadAllowed(uri, { kind: "ipfs-only" }), defaultIpfsGateway.template)
  assert.deepEqual(await loader(`ipfs://${cid}`), bytes)
  assert.equal(fetch.mock.calls[0].arguments[0], `https://ipfs.filebase.io/ipfs/${cid}`)
})


test("the viewer applies an operator wildcard without losing cancellation, cache or redirect policy", async t => {
  const controller = new AbortController()
  const fetch = t.mock.method(globalThis, "fetch", async () => new Response("CAM"))
  const loader = createViewerResourceLoader(uri => assertDownloadAllowed(uri, { kind: "https-or-ipfs" }), undefined, controller.signal)
  await loader("https://arbitrary.example.test/main.json")
  assert.deepEqual(fetch.mock.calls[0].arguments, ["https://arbitrary.example.test/main.json", {
    cache: "no-store", redirect: "error", signal: controller.signal,
  }])
})

test("gateway check retrieves the known file through the selected gateway with ordinary resource fetch policy", async t => {
  const fetch = t.mock.method(globalThis, "fetch", async () => new Response("hello world\n"))
  await checkIpfsGateway(defaultIpfsGateway.template, new AbortController().signal)
  const [url, options] = fetch.mock.calls[0]!.arguments
  assert.equal(url, defaultIpfsGateway.template.replace("{CID}", IPFS_GATEWAY_TEST_URI.slice(7)).replace("/{PATH}", ""))
  assert.deepEqual({ ...options, signal: undefined }, { ...RESOURCE_FETCH_OPTIONS, signal: undefined })
  assert(options!.signal instanceof AbortSignal)
})

test("HTTP errors and browser transport failures retain their causes", async t => {
  const fetch = t.mock.method(globalThis, "fetch", async () => new Response("Unavailable", { status: 503 }))
  await assert.rejects(checkIpfsGateway(defaultIpfsGateway.template, new AbortController().signal), error =>
    error instanceof Error && error.cause instanceof Error && error.cause.message.endsWith("HTTP 503"))
  const failure = new TypeError("browser cannot fetch this resource")
  fetch.mock.mockImplementation(async () => { throw failure })
  await assert.rejects(checkIpfsGateway(defaultIpfsGateway.template, new AbortController().signal), error =>
    error instanceof Error && error.cause === failure)
})

test("an HTTP failure aborts its fetch so an unread error body cannot keep downloading", async t => {
  let activeSignal: AbortSignal | undefined
  t.mock.method(globalThis, "fetch", async (_url: RequestInfo | URL, options?: RequestInit) => {
    activeSignal = options!.signal!
    return new Response(new ReadableStream<Uint8Array>(), { status: 503 })
  })
  await assert.rejects(checkIpfsGateway(defaultIpfsGateway.template, new AbortController().signal))
  assert.equal(activeSignal?.aborted, true)
})

test("an HTTP success with different bytes never passes the gateway check", async t => {
  const fetch = t.mock.method(globalThis, "fetch", async () => new Response("hello world"))
  await assert.rejects(checkIpfsGateway(defaultIpfsGateway.template, new AbortController().signal), /unexpected test-file contents/)
  fetch.mock.mockImplementation(async () => new Response("<html>Gateway unavailable</html>"))
  await assert.rejects(checkIpfsGateway(defaultIpfsGateway.template, new AbortController().signal), /unexpected test-file contents/)
})

test("gateway checks retain the shared streaming response limit", async t => {
  let cancelled = false
  t.mock.method(globalThis, "fetch", async () => new Response(new ReadableStream<Uint8Array>({
    start(controller) { controller.enqueue(new Uint8Array(CAM_RESOURCE_MAX_BYTES + 1)) },
    cancel() { cancelled = true },
  })))
  await assert.rejects(checkIpfsGateway(defaultIpfsGateway.template, new AbortController().signal), error =>
    error instanceof Error && error.cause instanceof Error && error.cause.message.includes("too large"))
  assert.equal(cancelled, true)
})

test("cancellation rejects a stalled gateway request and prevents an already-cancelled request", async t => {
  let activeSignal: AbortSignal | undefined
  const fetch = t.mock.method(globalThis, "fetch", async (_url: RequestInfo | URL, options?: RequestInit) => {
    activeSignal = options!.signal!
    return new Promise<Response>((_resolve, reject) => {
      activeSignal!.addEventListener("abort", () => reject(activeSignal!.reason), { once: true })
    })
  })
  const controller = new AbortController()
  const reason = new Error("operator cancelled")
  const result = checkIpfsGateway(defaultIpfsGateway.template, controller.signal)
  const rejected = assert.rejects(result, error => error === reason)
  controller.abort(reason)
  await rejected
  assert.equal(activeSignal?.aborted, true)
  await assert.rejects(checkIpfsGateway(defaultIpfsGateway.template, controller.signal), error => error === reason)
  assert.equal(fetch.mock.callCount(), 1)
})

test("the shared deadline bounds a gateway that never responds", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] })
  let activeSignal: AbortSignal | undefined
  t.mock.method(globalThis, "fetch", async (_url: RequestInfo | URL, options?: RequestInit) => {
    activeSignal = options!.signal!
    return new Promise<Response>(() => {})
  })
  const result = checkIpfsGateway(defaultIpfsGateway.template, new AbortController().signal)
  const rejected = assert.rejects(result, /exceeded 15 seconds/)
  t.mock.timers.tick(15_000)
  await rejected
  assert.equal(activeSignal?.aborted, true)
})
