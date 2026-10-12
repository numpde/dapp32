import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import test from "node:test"

import { calculateDocumentHashFromFile, calculateDocumentHashFromURL, DOCUMENT_HASH_MAX_BYTES } from "../src/document-hash.ts"

const expected = (bytes: Uint8Array) => `0x${createHash("sha256").update(bytes).digest("hex")}`

test("local hashing preserves binary bytes and never retrieves or uploads anything", async (t) => {
  const bytes = new Uint8Array([0, 255, 128, 13, 10, 0, 195, 40])
  const fetch = t.mock.method(globalThis, "fetch", () => { throw new Error("unexpected network") })
  assert.equal(await calculateDocumentHashFromFile(new File([bytes], "private.bin"), new AbortController().signal), expected(bytes))
  assert.equal(fetch.mock.callCount(), 0)
})

test("URL hashing explicitly requests readable bytes without credentials, referrer or redirects", async (t) => {
  const bytes = new Uint8Array([255, 0, 13, 10, 128])
  const fetch = t.mock.method(globalThis, "fetch", async (_uri: RequestInfo | URL, init?: RequestInit) => {
    assert.equal(init?.mode, "cors")
    assert.equal(init?.credentials, "omit")
    assert.equal(init?.referrerPolicy, "no-referrer")
    assert.equal(init?.redirect, "error")
    assert.equal(init?.cache, "no-store")
    assert(init?.signal instanceof AbortSignal)
    return new Response(bytes)
  })
  assert.equal(await calculateDocumentHashFromURL("https://documents.example.test/evidence", new AbortController().signal), expected(bytes))
  assert.equal(fetch.mock.callCount(), 1)
})

test("unsupported and credential-bearing URLs fail before retrieval", async (t) => {
  const fetch = t.mock.method(globalThis, "fetch", () => { throw new Error("unexpected network") })
  for (const uri of ["file:///secret", "ipfs://example", "https://user:password@example.test/file", "relative.txt"]) {
    await assert.rejects(calculateDocumentHashFromURL(uri, new AbortController().signal), /HTTP|URL|credential/i)
  }
  assert.equal(fetch.mock.callCount(), 0)
})

test("exact limit files are accepted and larger files fail before reading", async () => {
  const bytes = new Uint8Array(DOCUMENT_HASH_MAX_BYTES)
  assert.equal(await calculateDocumentHashFromFile(new File([bytes], "limit.bin"), new AbortController().signal), expected(bytes))
  const oversized = new File([bytes, new Uint8Array([1])], "large.bin")
  let read = false
  oversized.stream = () => { read = true; throw new Error("must not read") }
  await assert.rejects(calculateDocumentHashFromFile(oversized, new AbortController().signal), /8 MiB/)
  assert.equal(read, false)
})

test("URL limits apply to actual decoded body bytes regardless of transfer headers", async (t) => {
  let cancelled = false
  t.mock.method(globalThis, "fetch", async () => new Response(new ReadableStream({
    start(controller) { controller.enqueue(new Uint8Array(DOCUMENT_HASH_MAX_BYTES)); controller.enqueue(new Uint8Array([1])) },
    cancel() { cancelled = true },
  }), { headers: { "Content-Length": "1", "Content-Encoding": "gzip" } }))
  await assert.rejects(calculateDocumentHashFromURL("https://example.test/large", new AbortController().signal), /8 MiB/)
  assert.equal(cancelled, true)
})

test("unreadable and failed HTTP responses give file/manual alternatives", async (t) => {
  let cancelled = false
  t.mock.method(globalThis, "fetch", async () => new Response(new ReadableStream({ cancel() { cancelled = true } }), { status: 403 }))
  await assert.rejects(calculateDocumentHashFromURL("https://example.test/private", new AbortController().signal), /403.*file.*manual/i)
  assert.equal(cancelled, true)
  t.mock.method(globalThis, "fetch", async () => { throw new TypeError("Failed to fetch") })
  await assert.rejects(calculateDocumentHashFromURL("https://example.test/private", new AbortController().signal), /CORS.*file.*manual/i)
})

test("cancelling a stalled body stops acquisition", async (t) => {
  let cancelled = false
  t.mock.method(globalThis, "fetch", async () => new Response(new ReadableStream({ cancel() { cancelled = true } })))
  const controller = new AbortController()
  const pending = calculateDocumentHashFromURL("https://example.test/stalled", controller.signal)
  await new Promise(resolve => setImmediate(resolve))
  controller.abort()
  await assert.rejects(pending, /cancelled/i)
  assert.equal(cancelled, true)
})

test("opaque responses fail without attempting a no-cors retry", async (t) => {
  const response = Response.error()
  Object.defineProperty(response, "type", { value: "opaque" })
  const fetch = t.mock.method(globalThis, "fetch", async () => response)
  await assert.rejects(calculateDocumentHashFromURL("https://example.test/opaque", new AbortController().signal), /Cannot read document bytes.*file.*manual/i)
  assert.equal(fetch.mock.callCount(), 1)
})

test("deadline bounds a stalled fetch even if its transport ignores cancellation", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] })
  t.mock.method(globalThis, "fetch", () => new Promise<Response>(() => {}))
  const pending = calculateDocumentHashFromURL("https://example.test/stalled", new AbortController().signal)
  const rejected = assert.rejects(pending, /15 seconds.*file.*manual/i)
  t.mock.timers.tick(15_000)
  await rejected
})

test("deadline also bounds and cancels a stalled decoded response body", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] })
  let cancelled = false
  t.mock.method(globalThis, "fetch", async () => new Response(new ReadableStream({ cancel() { cancelled = true } })))
  const pending = calculateDocumentHashFromURL("https://example.test/stalled", new AbortController().signal)
  const rejected = assert.rejects(pending, /15 seconds/)
  await new Promise(resolve => setImmediate(resolve))
  t.mock.timers.tick(15_000)
  await rejected
  assert.equal(cancelled, true)
})

test("cancellation during non-abortable hashing discards the digest", async (t) => {
  let finish!: (value: ArrayBuffer) => void
  let hashing!: () => void
  const entered = new Promise<void>(resolve => { hashing = resolve })
  t.mock.method(crypto.subtle, "digest", () => { hashing(); return new Promise<ArrayBuffer>(resolve => { finish = resolve }) })
  const controller = new AbortController()
  const pending = calculateDocumentHashFromFile(new File(["private"], "private.txt"), controller.signal)
  await entered
  controller.abort()
  await assert.rejects(pending, /cancelled/i)
  finish(new ArrayBuffer(32))
})

test("a transport response arriving after cancellation releases its unread body", async (t) => {
  let respond!: (response: Response) => void
  let cancelled = false
  const body = new ReadableStream<Uint8Array>({ cancel() { cancelled = true } })
  t.mock.method(globalThis, "fetch", () => new Promise<Response>(resolve => { respond = resolve }))
  const controller = new AbortController()
  const pending = calculateDocumentHashFromURL("https://example.test/late", controller.signal)
  controller.abort()
  await assert.rejects(pending, /cancelled/i)
  respond(new Response(body))
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(cancelled, true)
  assert.equal(body.locked, false)
})
