import assert from "node:assert/strict"
import test from "node:test"

import { displayRpcEndpoint, parseStartupCoordinates, parseViewFragment, readStartupPolicy, resourcePolicyLabel, urlForActiveConnection, urlForView } from "../src/startup.ts"

const POLICY = {
  resourceOrigin: "https://resources.example.test",

}

test("view-link parsing keeps the parser cause behind its public explanation", () => {
  for (const fragment of ["#route=home&bad=%zz", "#route=home&inputs=%7Bbad%7D"]) {
    assert.throws(() => parseViewFragment(fragment), error => {
      assert(error instanceof Error)
      assert.match(error.message, /Cannot open view/)
      assert(error.cause instanceof Error, "the original parser reason remains available to diagnostics")
      return true
    })
  }
})

test("startup parser rejects duplicate deep-link parameters", () => {
  const url = validStartupUrl()
  url.searchParams.append("host", "0x0000000000000000000000000000000000000002")

  assert.throws(
    () => parseStartupCoordinates(url),
    /duplicate URL parameter: host/,
  )
})

test("startup permits a public view without inventing a selected account", () => {
  const url = validStartupUrl()
  url.searchParams.delete("account")
  const parsed = parseStartupCoordinates(url)
  assert.equal(parsed.account, undefined)
  assert.equal(Object.hasOwn(parsed, "account"), false)
  for (const invalid of ["", "not-an-address"]) {
    url.searchParams.set("account", invalid)
    assert.throws(() => parseStartupCoordinates(url), /account/)
  }
  url.searchParams.set("account", "0x0000000000000000000000000000000000000000")
  assert.equal(parseStartupCoordinates(url).account, "0x0000000000000000000000000000000000000000", "an explicitly selected watch address remains explicit")
  url.searchParams.append("account", "0x0000000000000000000000000000000000000001")
  assert.throws(() => parseStartupCoordinates(url), /duplicate URL parameter: account/)
})

test("public view links remove a previously selected account instead of leaking a read subject", () => {
  const linked = urlForView(validStartupUrl(), { route: "item", inputs: {} })
  assert.equal(linked.searchParams.has("account"), false)
  assert.equal(parseStartupCoordinates(linked).account, undefined)
})

test("connection coordinates remain available when RPC input is missing or needs correction", () => {
  const url = validStartupUrl()
  for (const value of [undefined, "", "not a URL"]) {
    if (value === undefined) url.searchParams.delete("rpcUrl")
    else url.searchParams.set("rpcUrl", value)
    assert.equal(parseStartupCoordinates(url).chainId, "eip155:31337")
    assert.equal(Object.hasOwn(parseStartupCoordinates(url), "rpcUrl"), false)
  }
})

test("view links retain matching supplied RPC but never serialize a newly selected endpoint", () => {
  const original = validStartupUrl()
  const unchanged = original.href
  assert.equal(urlForActiveConnection(original, "http://127.0.0.1:8545/").href, unchanged)
  const changed = urlForActiveConnection(original, "https://rpc.example.test/private-access-token")
  assert.equal(changed.searchParams.has("rpcUrl"), false)
  assert(!changed.href.includes("private-access-token"))
  assert.equal(original.href, unchanged)
  original.searchParams.set("rpcUrl", "not a URL")
  assert.equal(urlForActiveConnection(original, "https://rpc.example.test/").searchParams.has("rpcUrl"), false)
})

test("startup parser rejects unknown deep-link parameters", () => {
  const url = validStartupUrl()
  url.searchParams.set("chain", "eip155:31337")

  assert.throws(
    () => parseStartupCoordinates(url),
    /unknown URL parameter: chain/,
  )
})

test("startup policy permits IPFS-only loading without inventing an HTTP resource origin", () => {
  assert.deepEqual(readStartupPolicy({ VITE_CAM_WEB_RESOURCE_ORIGIN: "https://resources.example.test" }), POLICY)
  assert.deepEqual(readStartupPolicy({}), {})
  assert.deepEqual(readStartupPolicy({ VITE_CAM_WEB_RESOURCE_ORIGIN: "" }), {})
  assert.throws(() => readStartupPolicy({ VITE_CAM_WEB_RESOURCE_ORIGIN: "https://resources.example.test/path" }), /origin/)
})

test("operator resource policy supports any HTTP origin and explicit HTTP denial without URL overrides", () => {
  assert.deepEqual(readStartupPolicy({ VITE_CAM_WEB_RESOURCE_ORIGIN: "*" }), { resourceOrigin: "*" })
  assert.deepEqual(readStartupPolicy({ VITE_CAM_WEB_RESOURCE_ORIGIN: "none" }), {})
  const url = validStartupUrl()
  for (const name of ["resourceOrigin", "resourcePolicy"]) {
    const altered = new URL(url)
    altered.searchParams.set(name, "*")
    assert.throws(() => parseStartupCoordinates(altered), /unknown URL parameter/)
  }
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
  assert.deepEqual(parseStartupCoordinates(url), parseStartupCoordinates(validStartupUrl()))
  assert.deepEqual(parseViewFragment(url.hash), { route: "item", inputs })
})

test("an empty fragment keeps the manifest entry and empty inputs", () => {
  const parsed = parseViewFragment(validStartupUrl().hash)
  assert.equal("route" in parsed ? parsed.route : undefined, undefined)
  assert.deepEqual("inputs" in parsed ? parsed.inputs : undefined, {})
  const url = validStartupUrl()
  url.hash = "route=item"
  assert.deepEqual(parseViewFragment(url.hash).inputs, {})
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
    assert.throws(() => parseViewFragment(url.hash), fragment)
  }
})

test("simple string inputs have readable route parameters and preserve their exact meaning", () => {
  const inputs = { agreementId: "0x" + "ab".repeat(32), amount: "9007199254740993", flag: "true", empty: "", literal: "null" }
  const linked = urlForView(validStartupUrl(), { route: "item", inputs })
  assert.equal(linked.hash, "#route=item&agreementId=" + inputs.agreementId + "&amount=9007199254740993&flag=true&empty=&literal=null")
  assert.deepEqual(parseViewFragment(linked.hash).inputs, inputs)
  const empty = urlForView(validStartupUrl(), { route: "item", inputs: {} })
  assert.equal(empty.hash, "#route=item")
})

test("flat URL inputs decode punctuation, Unicode and prototype-named fields without coercion", () => {
  const inputs = { ["__proto__"]: "ordinary", constructor: "value", label: "a & + # 😃", escaped: "%7B", zero: "0" }
  const linked = urlForView(validStartupUrl(), { route: "item", inputs })
  assert.equal(new URLSearchParams(linked.hash.slice(1)).has("inputs"), false)
  assert.deepEqual(parseViewFragment(linked.hash).inputs, inputs)
})

test("flat URL inputs reject duplicate decoded names and mixed representation", () => {
  for (const hash of [
    "route=item&id=first&id=second", "route=item&id=first&%69d=second",
    "route=item&__proto__=first&__proto__=second",
    "route=item&inputs=%7B%7D&id=other",
  ]) {
    const url = validStartupUrl()
    url.hash = hash
    assert.throws(() => parseViewFragment(url.hash), hash)
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
    assert.deepEqual(parseViewFragment(linked.hash).inputs, inputs)
  }
})

test("flat inputs use the same decoded input byte limit as structured inputs", () => {
  const url = validStartupUrl()
  url.hash = new URLSearchParams({ route: "item", text: "😃".repeat(1024) }).toString()
  assert.throws(() => parseViewFragment(url.hash), /too large/)
})

test("URL numeric leaves must use exact decimal strings at every nesting level", () => {
  for (const inputs of ['{"id":1}', '{"id":9007199254740993}', '{"id":1e300}', '{"nested":[{"amount":0}]}']) {
    const url = validStartupUrl()
    url.hash = new URLSearchParams({ route: "item", inputs }).toString()
    assert.throws(() => parseViewFragment(url.hash), /decimal strings/, inputs)
  }
})

test("route fragment size and nesting are bounded before recursive JSON parsing", () => {
  for (const inputs of [JSON.stringify({ text: "a".repeat(4096) }), '{"nested":' + '['.repeat(33) + 'true' + ']'.repeat(33) + '}']) {
    const url = validStartupUrl()
    url.hash = new URLSearchParams({ route: "item", inputs }).toString()
    assert.throws(() => parseViewFragment(url.hash), /limit|too large|nesting/, inputs.slice(0, 40))
  }
  const url = validStartupUrl()
  url.hash = 'route=' + 'a'.repeat(16_385) + '&inputs=%7B%7D'
  assert.throws(() => parseViewFragment(url.hash), /limit|too large/)
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
  const parsed = parseViewFragment(next.hash)
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
  assert.equal(parseViewFragment(urlForView(current, { route: exact, inputs: {} }).hash).route, exact)
})

test("link bounds admit exact-limit text and count containers only outside JSON strings", () => {
  const current = validStartupUrl()
  const exact = { text: "x".repeat(4_085) }
  const next = urlForView(current, { route: "item", inputs: exact })
  assert.equal(new TextEncoder().encode(JSON.stringify(exact)).length, 4_096)
  assert.deepEqual(parseViewFragment(next.hash).inputs, exact)
  const punctuation = { text: '["\\\\"]'.repeat(80) }
  assert.deepEqual(parseViewFragment(urlForView(current, { route: "item", inputs: punctuation }).hash).inputs, punctuation)
})


test("connection policy labels describe the configured authority before a CAM is loaded", () => {
  assert.equal(resourcePolicyLabel({}), "HTTP(S) disabled; IPFS only")
  assert.equal(resourcePolicyLabel({ VITE_CAM_WEB_RESOURCE_ORIGIN: "none" }), "HTTP(S) disabled; IPFS only")
  assert.equal(resourcePolicyLabel({ VITE_CAM_WEB_RESOURCE_ORIGIN: "*" }), "Any HTTP(S) origin")
  assert.equal(resourcePolicyLabel({ VITE_CAM_WEB_RESOURCE_ORIGIN: "https://example.test:443/" }), "Pinned to https://example.test")
  assert.equal(resourcePolicyLabel({ VITE_CAM_WEB_RESOURCE_ORIGIN: "typo" }), "Invalid operator configuration")
  assert.throws(() => readStartupPolicy({ VITE_CAM_WEB_RESOURCE_ORIGIN: "typo" }), /expected absolute URL/)
})
