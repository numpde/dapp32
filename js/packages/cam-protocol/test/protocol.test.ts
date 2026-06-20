import assert from "node:assert/strict"
import test from "node:test"

import {
  abiScalarKind,
  assertCamResourceSize,
  assertCamSecondaryResourceURI,
  createExpressionRuntime,
  CamResourceIntegrityError,
  CAM_VERSION,
  InertValueError,
  isAbiAddressValue,
  isAbiBytesValue,
  isAbiFunctionName,
  isAbiFunctionSignatureReference,
  isAbiIntegerValue,
  isExpressionIdentifier,
  isFixedAbiArrayType,
  isSupportedAbiScalarType,
  parseAbiFixedBytesLength,
  parseAbiIntegerType,
  parseJsonText,
  readBoundedResponseBytes,
  requireHttpOrigin,
  requireHttpURL,
  requireSameHttpOrigin,
  toInertValue,
  UI_PROP_SCHEMAS,
  UI_VERSION,
  verifySha256ResourceIntegrity,
} from "../src/index.ts"

test("exports protocol document versions from the protocol package", () => {
  assert.equal(CAM_VERSION, "1.0.0")
  assert.equal(UI_VERSION, "1.0.0")
})

test("owns CAM-supported ABI scalar grammar", () => {
  assert.deepEqual(parseAbiIntegerType("int8"), { bits: 8, signed: true })
  assert.deepEqual(parseAbiIntegerType("uint"), { bits: 256, signed: false })
  assert.equal(parseAbiFixedBytesLength("bytes32"), 32)
  assert.equal(abiScalarKind("uint256"), "integer")
  assert.equal(abiScalarKind("bytes32"), "fixed-bytes")
  assert.equal(isSupportedAbiScalarType("address"), true)
  assert.equal(isSupportedAbiScalarType("uint257"), false)
  assert.equal(isSupportedAbiScalarType("bytes33"), false)
  assert.equal(isFixedAbiArrayType("uint256[2]"), true)
  assert.equal(isAbiAddressValue("0x0000000000000000000000000000000000000001"), true)
  assert.equal(isAbiAddressValue("0x0000000000000000000000000000000000000aAa"), true)
  assert.equal(isAbiAddressValue("0x00000000000000000000000000000000000000ZZ"), false)
  assert.equal(isAbiIntegerValue("255", { bits: 8, signed: false }), true)
  assert.equal(isAbiIntegerValue(256, { bits: 8, signed: false }), false)
  assert.equal(isAbiIntegerValue(Number.MAX_SAFE_INTEGER + 1, { bits: 256, signed: false }), false)
  assert.equal(isAbiBytesValue("0x1234"), true)
  assert.equal(isAbiBytesValue("0x123"), false)
  assert.equal(isAbiBytesValue("0x1234", 2), true)
  assert.equal(isAbiBytesValue("0x1234", 4), false)
})

test("owns CAM-supported ABI function reference grammar", () => {
  assert.equal(isAbiFunctionName("viewEntry"), true)
  assert.equal(isAbiFunctionName("_viewEntry1"), true)
  assert.equal(isAbiFunctionName("view-entry"), false)
  assert.equal(isAbiFunctionSignatureReference("viewEntry()"), true)
  assert.equal(isAbiFunctionSignatureReference("viewEntry(address,(uint256,string)[])"), true)
  assert.equal(isAbiFunctionSignatureReference("viewEntry(address"), false)
  assert.equal(isAbiFunctionSignatureReference("viewEntry(address) extra"), false)
  assert.equal(isAbiFunctionSignatureReference("viewEntry (address)"), false)
})

test("owns expression identifier grammar", () => {
  assert.equal(isExpressionIdentifier("serialNumber"), true)
  assert.equal(isExpressionIdentifier("serial_number1"), true)
  assert.equal(isExpressionIdentifier("_serialNumber"), false)
  assert.equal(isExpressionIdentifier("serial-number"), false)
  assert.equal(isExpressionIdentifier("1serialNumber"), false)
})

test("owns UI prop semantic buckets", () => {
  for (const [element, schema] of Object.entries(UI_PROP_SCHEMAS)) {
    for (const prop of schema.address) {
      assert.ok(
        (schema.string as readonly string[]).includes(prop),
        `${element}.${prop}: address props must also be string props`,
      )
    }
  }
})

test("resolves expression payloads with caller-owned normalization and errors", () => {
  const runtime = createExpressionRuntime({
    roots: new Set(["values"]),
    numericSegments: true,
    normalize(value) {
      return value
    },
    error(_kind, message, path) {
      return new Error(path === undefined ? message : `${path}: ${message}`)
    },
  })

  const resolved = runtime.resolveValue(
    {
      owner: "$values.0.owner",
    },
    {
      values: [
        {
          owner: "0x0000000000000000000000000000000000000001",
        },
      ],
    },
    "field",
  ) as { readonly owner?: unknown }

  assert.equal(resolved.owner, "0x0000000000000000000000000000000000000001")
  assert.equal(runtime.resolveValue("$$values.0.owner", { values: [] }, "field"), "$values.0.owner")
})

test("validates, clones, and rejects non-inert protocol values", () => {
  const source = {
    nested: {
      value: "before",
    },
  }

  const clone = toInertValue(source) as Record<string, unknown>
  const nested = clone.nested as Record<string, unknown>

  assert.equal(Object.getPrototypeOf(clone), null)
  assert.equal(Object.getPrototypeOf(nested), null)

  source.nested.value = "after"
  assert.equal(nested.value, "before")
  assert.throws(
    () => toInertValue({ route: { params: [new Date(0)] } }),
    (error) => error instanceof InertValueError
      && error.path === "route.params.0",
  )
})

test("parseJsonText rejects duplicate object keys before runtime parsing", () => {
  assert.deepEqual(parseJsonText('{"cam":"1.0.0","nested":{"key":1}}'), {
    cam: "1.0.0",
    nested: {
      key: 1,
    },
  })
  assert.throws(
    () => parseJsonText('{"cam":"1.0.0","cam":"2.0.0"}'),
    /duplicate JSON object key/,
  )
  assert.throws(
    () => parseJsonText('{"\\u0063am":"1.0.0","cam":"2.0.0"}'),
    /duplicate JSON object key/,
  )
})

test("validates HTTP resource boundaries and bounded response bytes", async () => {
  assertCamResourceSize(new Uint8Array(2), "https://example.test/small", 2)
  assert.throws(
    () => assertCamResourceSize(new Uint8Array(3), "https://example.test/large", 2),
    /too large/,
  )

  assert.equal(requireHttpURL("https://example.test/cam/main.json", "uri").href, "https://example.test/cam/main.json")
  assert.equal(requireHttpOrigin("https://example.test", "origin"), "https://example.test")
  assert.equal(
    requireSameHttpOrigin("https://example.test/cam/ui.json", "https://example.test", "uri").pathname,
    "/cam/ui.json",
  )
  assert.throws(() => requireHttpURL("ftp://example.test/x", "uri"), /http/)
  assert.throws(() => requireHttpURL("https://user@example.test/x", "uri"), /credentials/)
  assert.throws(() => requireHttpOrigin("https://example.test/path", "origin"), /origin/)
  assert.throws(() => requireSameHttpOrigin("https://other.test/x", "https://example.test", "uri"), /outside/)

  const small = await readBoundedResponseBytes(new Response("abc", {
    headers: {
      "content-length": "3",
    },
  }), "https://example.test/x", 3)
  assert.equal(new TextDecoder().decode(small), "abc")

  await assert.rejects(
    () => readBoundedResponseBytes(new Response("abcd", {
      headers: {
        "content-length": "4",
      },
    }), "https://example.test/x", 3),
    /too large/,
  )

  await assert.rejects(
    () => readBoundedResponseBytes(new Response("abcd"), "https://example.test/x", 3),
    /too large/,
  )

  await assert.rejects(
    () => readBoundedResponseBytes({
      body: {
        getReader() {
          return {
            async read() {
              return { done: false }
            },
          }
        },
      },
      headers: {
        get() {
          return null
        },
      },
    }, "https://example.test/x"),
    /empty chunk/,
  )
})

test("validates secondary CAM resource URI policy", () => {
  assert.doesNotThrow(() => assertCamSecondaryResourceURI("./abi/App.json", "uri"))
  assert.doesNotThrow(() => assertCamSecondaryResourceURI("ipfs://QmYwAPJzv5CZsnAzt8auVZRnJQt6P2JxC1ZyQ3GzFZ2q6x", "uri"))
  assert.doesNotThrow(() => assertCamSecondaryResourceURI("ipfs://QmYwAPJzv5CZsnAzt8auVZRnJQt6P2JxC1ZyQ3GzFZ2q6x/ui.json", "uri"))
  assert.doesNotThrow(() => assertCamSecondaryResourceURI("ipfs://bafybeigdyrzt5sfp7udm7hu76zryo5bugubxgwf3d2wwuom2gkdcbx3zva/ui.json", "uri"))

  for (const uri of [
    "https://example.test/ui.json",
    "ipfs://example/ui.json",
    "ipfs://Qm11111111111111111111111111111111111111111111/ui.json",
    "ipfs://bzzzzzzzzzzzzzzzzzzzz/ui.json",
    "ipfs://bafkrgiaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/ui.json",
    "ipfs://bqeafkeraaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/ui.json",
    "ipfs://zExampleMultibaseNotAcceptedYet/ui.json",
    "../ui.json",
    "./ui/../x.json",
    "./ui\\secret.json",
    "./%2e%2e/ui.json",
    "./ui%2fsecret.json",
    "./ui%5csecret.json",
    "./ui.json?version=1",
    "ipfs://../ui.json",
    "ipfs://ui\\secret.json",
    "ipfs://%2e%2e/ui.json",
  ]) {
    assert.throws(
      () => assertCamSecondaryResourceURI(uri, "uri"),
      /local .* ipfs:\/\/<CID>\[/,
    )
  }
})

test("validates sha256 resource integrity strings against caller-owned hashes", () => {
  assert.doesNotThrow(() => verifySha256ResourceIntegrity({
    actualHash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    integrity: "sha256:0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    uri: "./ui.json",
  }))

  assert.throws(
    () => verifySha256ResourceIntegrity({
      actualHash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      integrity: "sha512:0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      uri: "./ui.json",
    }),
    (error) => error instanceof CamResourceIntegrityError
      && error.code === "CAM_RESOURCE_INTEGRITY_INVALID",
  )

  assert.throws(
    () => verifySha256ResourceIntegrity({
      actualHash: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      integrity: "sha256:0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      uri: "./ui.json",
    }),
    (error) => error instanceof CamResourceIntegrityError
      && error.code === "CAM_RESOURCE_INTEGRITY_MISMATCH",
  )

  assert.throws(
    () => verifySha256ResourceIntegrity({
      actualHash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      integrity: "sha256:0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      uri: "./ui.json",
    }),
    (error) => error instanceof CamResourceIntegrityError
      && error.code === "CAM_RESOURCE_INTEGRITY_INVALID",
  )
})
