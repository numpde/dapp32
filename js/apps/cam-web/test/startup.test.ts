import assert from "node:assert/strict"
import test from "node:test"

import { displayRpcEndpoint, parseStartupOptions, readStartupPolicy, urlForView } from "../src/startup.ts"

const POLICY = {
  resourceOrigin: "https://resources.example.test",
  allowUnsignedCamHash: false,
}

test("startup parser rejects duplicate deep-link parameters", () => {
  const url = validStartupUrl()
  url.searchParams.append("host", "0x0000000000000000000000000000000000000002")

  assert.throws(
    () => parseStartupOptions(url, POLICY),
    /duplicate URL parameter: host/,
  )
})

test("startup parser rejects unknown deep-link parameters", () => {
  const url = validStartupUrl()
  url.searchParams.set("chain", "eip155:31337")

  assert.throws(
    () => parseStartupOptions(url, POLICY),
    /unknown URL parameter: chain/,
  )
})

test("startup policy requires explicit boolean text", () => {
  assert.deepEqual(readStartupPolicy({
    VITE_CAM_WEB_RESOURCE_ORIGIN: "https://resources.example.test",
    VITE_CAM_WEB_ALLOW_UNSIGNED_CAM_HASH: "false",
  }), POLICY)

  assert.throws(
    () => readStartupPolicy({
      VITE_CAM_WEB_RESOURCE_ORIGIN: "https://resources.example.test",
      VITE_CAM_WEB_ALLOW_UNSIGNED_CAM_HASH: "0",
    }),
    /expected "true" or "false"/,
  )
})

function validStartupUrl(): URL {
  const url = new URL("https://viewer.example.test/")
  url.searchParams.set("chainId", "eip155:31337")
  url.searchParams.set("host", "0x0000000000000000000000000000000000000001")
  url.searchParams.set("account", "0x0000000000000000000000000000000000000003")
  url.searchParams.set("rpcUrl", "http://127.0.0.1:8545")
  return url
}

test("RPC endpoint display omits path and query credentials", () => {
  assert.equal(
    displayRpcEndpoint("https://rpc.example.test/project-id?token=secret"),
    "https://rpc.example.test",
  )
})

test("fragment selects an exact read-route input object without changing connection settings", () => {
  const url = validStartupUrl()
  const inputs = { id: "9007199254740993", nested: [true, null, { ["__proto__"]: "ordinary" }], label: "a & + # 😃" }
  url.hash = new URLSearchParams({ route: "item", inputs: JSON.stringify(inputs) }).toString()
  const connection = parseStartupOptions(validStartupUrl(), POLICY)
  assert.deepEqual(parseStartupOptions(url, POLICY), { ...connection, route: "item", inputs })
})

test("an empty fragment keeps the manifest entry and empty inputs", () => {
  const parsed = parseStartupOptions(validStartupUrl(), POLICY)
  assert.equal("route" in parsed ? parsed.route : undefined, undefined)
  assert.deepEqual("inputs" in parsed ? parsed.inputs : undefined, {})
  const url = validStartupUrl()
  url.hash = "route=item"
  assert.deepEqual(parseStartupOptions(url, POLICY).inputs, {})
})

test("route fragments reject ambiguous, incomplete, or non-object requests", () => {
  for (const fragment of [
    "inputs=%7B%7D", "route=&inputs=%7B%7D", "route=item&inputs=",
    "route=item&route=other&inputs=%7B%7D", "route=item&inputs=%7B%7D&inputs=%7B%7D",
    "route=item&inputs=%7B%7D&extra=x", "section", "route=item&inputs=null",
    "route=item&inputs=[]", "route=item&inputs=true", "route=item&inputs=%7B",
    'route=item&inputs=%7B%22a%22%3A%22x%22%2C%22a%22%3A%22y%22%7D',
    'route=item&inputs=%7B%22a%22%3A%7B%22x%22%3Atrue%2C%22%5Cu0078%22%3Afalse%7D%7D',
  ]) {
    const url = validStartupUrl()
    url.hash = fragment
    assert.throws(() => parseStartupOptions(url, POLICY), fragment)
  }
})

test("simple string inputs have readable route parameters and preserve their exact meaning", () => {
  const inputs = { agreementId: "0x" + "ab".repeat(32), amount: "9007199254740993", flag: "true", empty: "", literal: "null" }
  const linked = urlForView(validStartupUrl(), { route: "item", inputs })
  assert.equal(linked.hash, "#route=item&agreementId=" + inputs.agreementId + "&amount=9007199254740993&flag=true&empty=&literal=null")
  assert.deepEqual(parseStartupOptions(linked, POLICY).inputs, inputs)
  const empty = urlForView(validStartupUrl(), { route: "item", inputs: {} })
  assert.equal(empty.hash, "#route=item")
})

test("flat URL inputs decode punctuation, Unicode and prototype-named fields without coercion", () => {
  const inputs = { ["__proto__"]: "ordinary", constructor: "value", label: "a & + # 😃", escaped: "%7B", zero: "0" }
  const linked = urlForView(validStartupUrl(), { route: "item", inputs })
  assert.equal(new URLSearchParams(linked.hash.slice(1)).has("inputs"), false)
  assert.deepEqual(parseStartupOptions(linked, POLICY).inputs, inputs)
})

test("flat URL inputs reject duplicate decoded names and mixed representation", () => {
  for (const hash of [
    "route=item&id=first&id=second", "route=item&id=first&%69d=second",
    "route=item&__proto__=first&__proto__=second",
    "route=item&inputs=%7B%7D&id=other",
  ]) {
    const url = validStartupUrl()
    url.hash = hash
    assert.throws(() => parseStartupOptions(url, POLICY), hash)
  }
})

test("structured and reserved-name inputs use one JSON envelope without changing their types", () => {
  for (const inputs of [
    { nested: [true, null, { text: "value" }] },
    { route: "input route", other: "value" },
    { inputs: "literal input", other: "value" },
    { text: "lone\uD800" },
    { ["lone\uDC00"]: "value" },
  ]) {
    const linked = urlForView(validStartupUrl(), { route: "item", inputs })
    assert.deepEqual([...new URLSearchParams(linked.hash.slice(1)).keys()], ["route", "inputs"])
    assert.deepEqual(parseStartupOptions(linked, POLICY).inputs, inputs)
  }
})

test("flat inputs use the same decoded input byte limit as structured inputs", () => {
  const url = validStartupUrl()
  url.hash = new URLSearchParams({ route: "item", text: "😃".repeat(1024) }).toString()
  assert.throws(() => parseStartupOptions(url, POLICY), /too large/)
})

test("URL numeric leaves must use exact decimal strings at every nesting level", () => {
  for (const inputs of ['{"id":1}', '{"id":9007199254740993}', '{"id":1e300}', '{"nested":[{"amount":0}]}']) {
    const url = validStartupUrl()
    url.hash = new URLSearchParams({ route: "item", inputs }).toString()
    assert.throws(() => parseStartupOptions(url, POLICY), /decimal strings/, inputs)
  }
})

test("route fragment size and nesting are bounded before recursive JSON parsing", () => {
  for (const inputs of [JSON.stringify({ text: "a".repeat(4096) }), '{"nested":' + '['.repeat(33) + 'true' + ']'.repeat(33) + '}']) {
    const url = validStartupUrl()
    url.hash = new URLSearchParams({ route: "item", inputs }).toString()
    assert.throws(() => parseStartupOptions(url, POLICY), /limit|too large|nesting/, inputs.slice(0, 40))
  }
  const url = validStartupUrl()
  url.hash = 'route=' + 'a'.repeat(16_385) + '&inputs=%7B%7D'
  assert.throws(() => parseStartupOptions(url, POLICY), /limit|too large/)
})

test("view URL round trips exact route inputs and the actual viewing account without replacing RPC settings", () => {
  const current = validStartupUrl()
  current.searchParams.set("rpcUrl", "https://rpc.example.test/project?token=private")
  const view = {
    route: "item",
    inputs: { amount: "9007199254740993", nested: [true, null, { ["__proto__"]: "ordinary" }], label: "a & + # 😃" },
    account: { address: "0x0000000000000000000000000000000000000004" as const },
  }
  const next = urlForView(current, view)
  assert.equal(current.hash, "")
  assert.equal(next.searchParams.get("rpcUrl"), current.searchParams.get("rpcUrl"))
  assert.equal(next.searchParams.get("chainId"), current.searchParams.get("chainId"))
  assert.equal(next.searchParams.get("host"), current.searchParams.get("host"))
  assert.equal(next.searchParams.get("account"), view.account.address)
  const parsed = parseStartupOptions(next, POLICY)
  assert.equal(parsed.route, view.route)
  assert.deepEqual(parsed.inputs, view.inputs)
})

test("link serialization rejects values it cannot represent exactly instead of coercing them", () => {
  const current = validStartupUrl()
  assert.throws(() => urlForView(current, { route: "item", inputs: { amount: 1 } }), /decimal strings/)
  assert.throws(() => urlForView(current, { route: "item", inputs: { note: "😃".repeat(1024) } }), /too large/)
  assert.equal(current.hash, "")
})

test("link serialization rejects route names that URL encoding would change", () => {
  const current = validStartupUrl()
  for (const route of ["item\uD800", "\uDC00item"]) {
    assert.throws(() => urlForView(current, { route, inputs: {} }), /route.*exact|route.*Unicode/)
  }
  assert.equal(current.hash, "")
  const exact = "item 😃"
  assert.equal(parseStartupOptions(urlForView(current, { route: exact, inputs: {} }), POLICY).route, exact)
})

test("link bounds admit exact-limit text and count containers only outside JSON strings", () => {
  const current = validStartupUrl()
  const exact = { text: "x".repeat(4_085) }
  const next = urlForView(current, { route: "item", inputs: exact })
  assert.equal(new TextEncoder().encode(JSON.stringify(exact)).length, 4_096)
  assert.deepEqual(parseStartupOptions(next, POLICY).inputs, exact)
  const punctuation = { text: '["\\\\"]'.repeat(80) }
  assert.deepEqual(parseStartupOptions(urlForView(current, { route: "item", inputs: punctuation }), POLICY).inputs, punctuation)
})
