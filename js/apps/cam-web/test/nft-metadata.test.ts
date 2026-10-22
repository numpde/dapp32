import assert from "node:assert/strict"
import test from "node:test"

import {
  NFT_IMAGE_MAX_BYTES,
  NFT_METADATA_MAX_BYTES,
  loadNftImage,
  loadNftMetadata,
  nftMetadataDataURI,
  parseNftMetadata,
  serializeNftMetadata,
} from "../src/nft-metadata.ts"

const signal = () => new AbortController().signal
const plain = (value: unknown) => JSON.parse(JSON.stringify(value)) as unknown

test("metadata preserves extension fields and primitive traits through edits, JSON and Unicode data URI export", async t => {
  const fetch = t.mock.method(globalThis, "fetch", () => { throw new Error("unexpected network") })
  const original = parseNftMetadata('{"name":"自転車 🚲","description":"Original","attributes":[{"trait_type":"Year","value":2026},{"trait_type":"Active","value":true}],"extension":{"__proto__":"ordinary","note":"a\\\"[{"}}')
  const changed = { ...original, description: "Corrected" }
  const json = serializeNftMetadata(changed)
  assert.deepEqual(plain(parseNftMetadata(json)), plain(changed))
  assert.deepEqual(plain(await loadNftMetadata(nftMetadataDataURI(changed), signal())), plain(changed))
  assert.deepEqual(plain(await loadNftMetadata(`data:application/json;charset=utf-8,${encodeURIComponent(json)}`, signal())), plain(changed))
  assert.equal(original.description, "Original")
  assert.equal(fetch.mock.callCount(), 0)
})

test("metadata requires a JSON object, unique keys, finite values and bounded nesting", () => {
  for (const text of ['[]', 'null', 'true', '{', '{"name":1,"name":2}', '{"value":1e400}']) {
    assert.throws(() => parseNftMetadata(text), /JSON|object|finite/)
  }
  assert.throws(() => parseNftMetadata('{"value":' + '['.repeat(32) + '0' + ']'.repeat(32) + '}'), /nesting limit/)
  assert.equal(parseNftMetadata('{"text":"' + '['.repeat(40) + '"}').text, '['.repeat(40))
})

test("metadata size is measured in UTF-8 bytes, including exact-limit and multibyte content", () => {
  const exact = '{"value":"' + 'a'.repeat(NFT_METADATA_MAX_BYTES - 12) + '"}'
  assert.equal(new TextEncoder().encode(exact).length, NFT_METADATA_MAX_BYTES)
  assert.equal(typeof parseNftMetadata(exact).value, "string")
  assert.throws(() => parseNftMetadata(exact + ' '), /256 KiB/)
  assert.throws(() => parseNftMetadata('{"value":"' + '🚲'.repeat(NFT_METADATA_MAX_BYTES / 4) + '"}'), /256 KiB/)
})

test("malformed, oversized and non-JSON data URIs fail without network access", async t => {
  const fetch = t.mock.method(globalThis, "fetch", () => { throw new Error("unexpected network") })
  for (const uri of [
    'data:application/json;base64,!!',
    'data:application/json,%zz',
    'data:text/html,%7B%7D',
    'data:application/json;charset=latin1,%7B%7D',
    'data:application/json;base64,/w==',
    'data:application/json;base64,' + 'a'.repeat(Math.ceil(NFT_METADATA_MAX_BYTES / 3) * 4 + 4),
  ]) await assert.rejects(loadNftMetadata(uri, signal()), /data URI|UTF-8/)
  assert.equal(fetch.mock.callCount(), 0)
})

test("metadata retrieval has explicit browser policy and does not request its image", async t => {
  const fetch = t.mock.method(globalThis, "fetch", async (uri: RequestInfo | URL, init?: RequestInit) => {
    assert.equal(uri, "https://metadata.example/item.json")
    assert.equal(init?.mode, "cors")
    assert.equal(init?.credentials, "omit")
    assert.equal(init?.referrerPolicy, "no-referrer")
    assert.equal(init?.redirect, "error")
    assert.equal(init?.cache, "no-store")
    assert.ok(init?.signal instanceof AbortSignal)
    return new Response('{"image":"https://other.example/tracker.png"}')
  })
  assert.equal((await loadNftMetadata("https://metadata.example/item.json", signal())).image, "https://other.example/tracker.png")
  assert.equal(fetch.mock.callCount(), 1)
})

test("unsupported metadata schemes and credential-bearing URLs fail before retrieval", async t => {
  const fetch = t.mock.method(globalThis, "fetch", () => { throw new Error("unexpected network") })
  for (const uri of ['ipfs://example/item', 'javascript:alert(1)', '/relative.json', 'https://user:secret@example.test/item']) {
    await assert.rejects(loadNftMetadata(uri, signal()), /HTTP|URL|credential/i)
  }
  assert.equal(fetch.mock.callCount(), 0)
})

test("HTTP status and unreadable/CORS resources explain the failed operation", async t => {
  t.mock.method(globalThis, "fetch", async () => new Response("missing", { status: 404 }))
  await assert.rejects(loadNftMetadata("https://example.test/item", signal()), /NFT metadata.*HTTP 404/)
  t.mock.restoreAll()
  t.mock.method(globalThis, "fetch", async () => { throw new TypeError("Failed to fetch") })
  await assert.rejects(loadNftMetadata("https://example.test/item", signal()), /CORS.*redirects/)
})

test("streamed metadata enforces its decoded byte cap and UTF-8 validity", async t => {
  t.mock.method(globalThis, "fetch", async () => new Response(new Uint8Array(NFT_METADATA_MAX_BYTES + 1)))
  await assert.rejects(loadNftMetadata("https://example.test/item", signal()), /256 KiB/)
  t.mock.restoreAll()
  t.mock.method(globalThis, "fetch", async () => new Response(new Uint8Array([255])))
  await assert.rejects(loadNftMetadata("https://example.test/item", signal()), /UTF-8/)
})

test("cancellation settles even when fetch ignores its signal", async t => {
  t.mock.method(globalThis, "fetch", () => new Promise<Response>(() => {}))
  const controller = new AbortController()
  const pending = loadNftMetadata("https://example.test/item", controller.signal)
  const reason = new Error("View changed")
  controller.abort(reason)
  await assert.rejects(pending, error => error === reason)
})

test("a stalled request reaches its deadline even when fetch ignores abort", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] })
  t.mock.method(globalThis, "fetch", () => new Promise<Response>(() => {}))
  const pending = loadNftMetadata("https://example.test/item", signal())
  const rejected = assert.rejects(pending, /exceeded 15 seconds/)
  t.mock.timers.tick(15_000)
  await rejected
})

test("relative image sources use the explicit metadata HTTP base and return owned raster bytes", async t => {
  t.mock.method(globalThis, "fetch", async (uri: RequestInfo | URL) => {
    assert.equal(uri, "https://example.test/images/bike.png")
    return new Response(new Uint8Array([1, 2, 3]), { headers: { "Content-Type": "image/png" } })
  })
  const blob = await loadNftImage("../images/bike.png", "https://example.test/items/12.json", signal())
  assert.equal(blob.type, "image/png")
  assert.deepEqual(new Uint8Array(await blob.arrayBuffer()), new Uint8Array([1, 2, 3]))
})

test("raster data images are local; executable and relative-without-base sources fail", async t => {
  const fetch = t.mock.method(globalThis, "fetch", () => { throw new Error("unexpected network") })
  assert.equal((await loadNftImage("data:image/png;base64,AQID", undefined, signal())).size, 3)
  for (const [uri, base] of [["data:image/svg+xml,%3Csvg%3E", undefined], ["javascript:alert(1)", undefined], ["image.png", "data:application/json,%7B%7D"], ["image.png", undefined]] as const) {
    await assert.rejects(loadNftImage(uri, base, signal()), /SVG|HTTP|URL|relative/)
  }
  assert.equal(fetch.mock.callCount(), 0)
})

test("image retrieval rejects HTML/SVG responses and bounds streamed raster bytes", async t => {
  for (const type of ["text/html", "image/svg+xml", ""]) {
    t.mock.method(globalThis, "fetch", async () => new Response("untrusted", { headers: { "Content-Type": type } }))
    await assert.rejects(loadNftImage("https://example.test/image", undefined, signal()), /PNG.*SVG/)
    t.mock.restoreAll()
  }
  t.mock.method(globalThis, "fetch", async () => new Response(new Uint8Array([1, 2, 3])))
  await assert.rejects(loadNftImage("https://example.test/image", undefined, signal()), /Content-Type header/)
  t.mock.restoreAll()
  t.mock.method(globalThis, "fetch", async () => new Response(new Uint8Array(NFT_IMAGE_MAX_BYTES + 1), { headers: { "Content-Type": "image/png" } }))
  await assert.rejects(loadNftImage("https://example.test/image", undefined, signal()), /4096 KiB/)
})


test("cancelling a stalled response stream settles and cancels the reader", async t => {
  let cancelled = false
  const body = new ReadableStream<Uint8Array>({ cancel() { cancelled = true } })
  t.mock.method(globalThis, "fetch", async () => new Response(body))
  const controller = new AbortController()
  const pending = loadNftMetadata("https://example.test/item", controller.signal)
  await new Promise<void>(resolve => setImmediate(resolve))
  const reason = new Error("Account changed")
  controller.abort(reason)
  await assert.rejects(pending, error => error === reason)
  assert.equal(cancelled, true)
})
