import assert from "node:assert/strict"
import test from "node:test"

import {
  abiDynamicArrayElementType,
  abiFunctionSignature,
  abiScalarKind,
  abiTupleArraySuffix,
  abiTypeSignature,
  assertCamResourceSize,
  assertCamSecondaryResourceURI,
  assertLoadableCamRootURI,
  assertPublishedCamRootURI,
  createExpressionRuntime,
  createSameOriginHttpResourceLoader,
  expressionReferenceSyntaxError,
  CamResourceIntegrityError,
  CAM_MANIFEST_TOP_LEVEL_KEYS,
  CAM_NAMESPACE_TYPES,
  CAM_NAMESPACE_RESOURCE_URI_KEYS,
  CAM_READ_ROUTE_THEN_NAMESPACE_TYPES,
  CAM_ROUTE_CALL_NAMESPACE_TYPES,
  CAM_ROUTE_KINDS,
  CAM_WRITE_ROUTE_THEN_NAMESPACE_TYPES,
  CAM_ROUTE_CONTEXT_KEYS,
  collectCamInvocationFact,
  collectCamNamespaceFacts,
  collectCamResourceDeclarationFacts,
  collectCamRouteExpressionDiagnostics,
  collectCamRouteInputsFact,
  collectCamRootFact,
  collectExpressionReferences,
  CAM_VERSION,
  diffNameSets,
  InertValueError,
  isAbiAddressValue,
  isAbiBytesValue,
  isAbiFunctionName,
  isAbiFunctionSignatureReference,
  isAbiIntegerValue,
  isAbiStateMutability,
  inspectAbiParameterNames,
  camNamespaceResourceURIKey,
  camRouteThenNamespaceTypes,
  isCamNamespaceType,
  isCamResourceNamespaceType,
  isCamRouteKind,
  isExpressionArrayIndex,
  isExpressionIdentifier,
  isExpressionReferenceString,
  isCamNamespaceNameForType,
  isUiPropElement,
  isFixedAbiArrayType,
  isSupportedAbiScalarType,
  nameListShapeIssues,
  parseAbiFixedBytesLength,
  parseAbiIntegerType,
  parseExpressionReference,
  parseStaticExpressionString,
  parseJsonBytes,
  parseJsonText,
  readBoundedResponseBytes,
  requireHttpOrigin,
  requireHttpURL,
  requireSameHttpOrigin,
  responseContentLength,
  resolveCamResourceURI,
  toInertValue,
  UI_CALL_NAMESPACE_BY_ELEMENT,
  UI_CONTEXT_KEYS,
  UI_DOCUMENT_TOP_LEVEL_KEYS,
  UI_PROP_SCHEMAS,
  UI_RUNTIME_ROOTS,
  UI_VERSION,
  uiCallNamespaceForElement,
  verifySha256ResourceIntegrity,
} from "../src/index.ts"

test("exports protocol document versions from the protocol package", () => {
  assert.equal(CAM_VERSION, "1.0.0")
  assert.equal(UI_VERSION, "1.0.0")
})

test("owns top-level document field vocabularies", () => {
  assert.deepEqual([...CAM_MANIFEST_TOP_LEVEL_KEYS], ["cam", "entry", "namespaces", "routes"])
  assert.deepEqual([...UI_DOCUMENT_TOP_LEVEL_KEYS], ["ui", "nodes"])
})

test("owns manifest namespace and route vocabularies", () => {
  assert.deepEqual([...CAM_NAMESPACE_TYPES], ["contract", "routes", "ui"])
  assert.equal(isCamNamespaceType("contract"), true)
  assert.equal(isCamNamespaceType("routes"), true)
  assert.equal(isCamNamespaceType("ui"), true)
  assert.equal(isCamNamespaceType("widget"), false)
  assert.equal(isCamResourceNamespaceType("contract"), true)
  assert.equal(isCamResourceNamespaceType("ui"), true)
  assert.equal(isCamResourceNamespaceType("routes"), false)
  assert.equal(isCamNamespaceNameForType("contracts.App", "contract"), true)
  assert.equal(isCamNamespaceNameForType("contracts._App2", "contract"), true)
  assert.equal(isCamNamespaceNameForType("contracts.", "contract"), false)
  assert.equal(isCamNamespaceNameForType("contracts.App.V1", "contract"), false)
  assert.equal(isCamNamespaceNameForType("contracts.App-1", "contract"), false)
  assert.equal(isCamNamespaceNameForType("App", "contract"), false)
  assert.equal(isCamNamespaceNameForType("routes", "routes"), true)
  assert.equal(isCamNamespaceNameForType("flows", "routes"), false)
  assert.equal(isCamNamespaceNameForType("ui", "ui"), true)
  assert.equal(isCamNamespaceNameForType("screens", "ui"), false)
  assert.deepEqual(CAM_NAMESPACE_RESOURCE_URI_KEYS, {
    contract: "abiURI",
    ui: "uri",
  })
  assert.equal(camNamespaceResourceURIKey("contract"), "abiURI")
  assert.equal(camNamespaceResourceURIKey("ui"), "uri")
  assert.equal(camNamespaceResourceURIKey("routes"), undefined)
  assert.deepEqual([...CAM_ROUTE_KINDS], ["read", "write"])
  assert.equal(isCamRouteKind("read"), true)
  assert.equal(isCamRouteKind("write"), true)
  assert.equal(isCamRouteKind("browse"), false)
  assert.deepEqual([...CAM_ROUTE_CALL_NAMESPACE_TYPES], ["contract"])
  assert.deepEqual([...CAM_READ_ROUTE_THEN_NAMESPACE_TYPES], ["ui"])
  assert.deepEqual([...CAM_WRITE_ROUTE_THEN_NAMESPACE_TYPES], ["routes"])
  assert.equal(camRouteThenNamespaceTypes("read"), CAM_READ_ROUTE_THEN_NAMESPACE_TYPES)
  assert.equal(camRouteThenNamespaceTypes("write"), CAM_WRITE_ROUTE_THEN_NAMESPACE_TYPES)
})

test("collects CAM root, namespace, and resource declaration facts", () => {
  const root = {
    cam: CAM_VERSION,
    entry: "main",
    namespaces: {
      "contracts.App": {
        type: "contract",
        abiURI: "./abi/App.json",
        integrity: "sha256:fixture",
      },
      routes: {
        type: "routes",
      },
      ui: {
        type: "ui",
        uri: "./ui/main.json",
        integrity: "sha256:ui",
      },
    },
    extra: true,
  }
  const rootResult = collectCamRootFact(root, { resource: "cam" })

  assert.equal(rootResult.value?.version, CAM_VERSION)
  assert.deepEqual(rootResult.diagnostics, [{
    code: "CAM_FACT_ROOT_FIELD_UNKNOWN",
    resource: "cam",
    message: `field is not allowed in CAM ${CAM_VERSION}: extra`,
    path: "extra",
  }])

  const namespaceResult = collectCamNamespaceFacts(rootResult.value!)
  assert.deepEqual(namespaceResult.diagnostics, [])
  assert.deepEqual(
    namespaceResult.namespaces.map((namespace) => [namespace.name, namespace.type, namespace.path]),
    [
      ["contracts.App", "contract", "namespaces.contracts.App"],
      ["routes", "routes", "namespaces.routes"],
      ["ui", "ui", "namespaces.ui"],
    ],
  )

  const resourceResult = collectCamResourceDeclarationFacts(namespaceResult.namespaces)
  assert.deepEqual(resourceResult.diagnostics, [])
  assert.deepEqual(resourceResult.declarations.map((declaration) => ({
    sourceResource: declaration.sourceResource,
    namespace: declaration.namespace,
    namespaceType: declaration.namespaceType,
    uri: declaration.uri,
    integrity: declaration.integrity,
    uriPath: declaration.uriPath,
    integrityPath: declaration.integrityPath,
  })), [
    {
      sourceResource: "cam",
      namespace: "contracts.App",
      namespaceType: "contract",
      uri: "./abi/App.json",
      integrity: "sha256:fixture",
      uriPath: "namespaces.contracts.App.abiURI",
      integrityPath: "namespaces.contracts.App.integrity",
    },
    {
      sourceResource: "cam",
      namespace: "ui",
      namespaceType: "ui",
      uri: "./ui/main.json",
      integrity: "sha256:ui",
      uriPath: "namespaces.ui.uri",
      integrityPath: "namespaces.ui.integrity",
    },
  ])
})

test("collects ordered CAM fact diagnostics without conformance policy", () => {
  assert.deepEqual(collectCamRootFact(null, { resource: "cam" }), {
    diagnostics: [{
      code: "CAM_FACT_ROOT_NOT_OBJECT",
      resource: "cam",
      message: "CAM root document must be a JSON object",
    }],
  })
  assert.deepEqual(collectCamRootFact({ cam: "2.0.0", extra: true }, { resource: "cam" }), {
    diagnostics: [{
      code: "CAM_FACT_ROOT_VERSION_INVALID",
      resource: "cam",
      message: "unsupported CAM version: 2.0.0",
      path: "cam",
    }],
  })

  const namespaceRoot = collectCamRootFact({
    cam: CAM_VERSION,
    namespaces: {
      "": { type: "ui" },
      bad: null,
      unknown: { type: "widget" },
      routesWrong: { type: "routes" },
      "contracts.App": { type: "contract", abiURI: "../bad.json", integrity: "sha256:fixture" },
      ui: { type: "ui", uri: "../bad.json", integrity: "" },
    },
  }, { resource: "cam" }).value!
  const namespaceResult = collectCamNamespaceFacts(namespaceRoot)
  assert.deepEqual(namespaceResult.diagnostics.map((diagnostic) => [
    diagnostic.code,
    diagnostic.path,
    diagnostic.message,
  ]), [
    ["CAM_FACT_NAMESPACE_NAME_EMPTY", "namespaces", "namespace name must not be empty"],
    ["CAM_FACT_NAMESPACE_NOT_OBJECT", "namespaces.bad", "namespace must be an object: bad"],
    ["CAM_FACT_NAMESPACE_TYPE_INVALID", "namespaces.unknown.type", "unknown namespace type: widget"],
    ["CAM_FACT_NAMESPACE_NAME_INVALID", "namespaces.routesWrong", "routes namespace must be named routes"],
  ])

  const resourceResult = collectCamResourceDeclarationFacts(namespaceResult.namespaces)
  assert.deepEqual(resourceResult.diagnostics.map((diagnostic) => [
    diagnostic.code,
    diagnostic.path,
    diagnostic.message,
  ]), [
    ["CAM_FACT_RESOURCE_URI_POLICY_INVALID", "namespaces.contracts.App.abiURI", "namespaces.contracts.App.abiURI: CAM resource URI must be local ./... or ipfs://<CID>[...]: ../bad.json"],
    ["CAM_FACT_RESOURCE_INTEGRITY_INVALID", "namespaces.ui.integrity", "CAM resource integrity must be a non-empty string: ui"],
  ])
})

test("collects valid route invocation facts", () => {
  const namespaceTypes = new Map([
    ["contracts.App", "contract"],
    ["routes", "routes"],
    ["ui", "ui"],
  ] as const)

  assert.deepEqual(collectCamInvocationFact({
    resource: "cam",
    path: "routes.entry.call",
    invocation: {
      namespace: "contracts.App",
      function: "viewEntry",
      args: {
        account: "$account.address",
      },
    },
    namespaceTypes,
    allowedNamespaceTypes: CAM_ROUTE_CALL_NAMESPACE_TYPES,
    purpose: "route call",
  }), {
    value: {
      resource: "cam",
      path: "routes.entry.call",
      namespace: "contracts.App",
      namespaceType: "contract",
      function: "viewEntry",
      args: {
        account: "$account.address",
      },
    },
    diagnostics: [],
  })

  assert.deepEqual(collectCamInvocationFact({
    resource: "cam",
    path: "routes.entry.then",
    invocation: {
      namespace: "ui",
      function: "app",
      args: {
        view: "$outputs.0",
      },
    },
    namespaceTypes,
    allowedNamespaceTypes: CAM_READ_ROUTE_THEN_NAMESPACE_TYPES,
    purpose: "route continuation",
  }), {
    value: {
      resource: "cam",
      path: "routes.entry.then",
      namespace: "ui",
      namespaceType: "ui",
      function: "app",
      args: {
        view: "$outputs.0",
      },
    },
    diagnostics: [],
  })

  assert.deepEqual(collectCamInvocationFact({
    resource: "cam",
    path: "routes.save.then",
    invocation: {
      namespace: "routes",
      function: "entry",
      args: {},
    },
    namespaceTypes,
    allowedNamespaceTypes: CAM_WRITE_ROUTE_THEN_NAMESPACE_TYPES,
    purpose: "route continuation",
  }), {
    value: {
      resource: "cam",
      path: "routes.save.then",
      namespace: "routes",
      namespaceType: "routes",
      function: "entry",
      args: {},
    },
    diagnostics: [],
  })
})

test("collects ordered route invocation diagnostics", () => {
  const namespaceTypes = new Map([
    ["contracts.App", "contract"],
    ["routes", "routes"],
    ["ui", "ui"],
  ] as const)

  const cases = [
    {
      invocation: null,
      allowedNamespaceTypes: CAM_ROUTE_CALL_NAMESPACE_TYPES,
      expected: [
        ["CAM_FACT_INVOCATION_NOT_OBJECT", "routes.entry.call", "route call must be an object"],
      ],
    },
    {
      invocation: {
        namespace: "",
        function: "",
        args: [],
      },
      allowedNamespaceTypes: CAM_ROUTE_CALL_NAMESPACE_TYPES,
      expected: [
        ["CAM_FACT_INVOCATION_FUNCTION_INVALID", "routes.entry.call.function", "route call function must be a non-empty string"],
        ["CAM_FACT_INVOCATION_ARGS_INVALID", "routes.entry.call.args", "route call args must be an object"],
        ["CAM_FACT_INVOCATION_NAMESPACE_INVALID", "routes.entry.call.namespace", "route call namespace must be a non-empty string"],
      ],
    },
    {
      invocation: {
        namespace: "contracts.Missing",
        function: "viewEntry",
        args: {},
      },
      allowedNamespaceTypes: CAM_ROUTE_CALL_NAMESPACE_TYPES,
      expected: [
        ["CAM_FACT_INVOCATION_NAMESPACE_UNKNOWN", "routes.entry.call.namespace", "route call references unknown namespace: contracts.Missing"],
      ],
    },
    {
      invocation: {
        namespace: "ui",
        function: "viewEntry",
        args: {},
      },
      allowedNamespaceTypes: CAM_ROUTE_CALL_NAMESPACE_TYPES,
      expected: [
        ["CAM_FACT_INVOCATION_NAMESPACE_TYPE_INVALID", "routes.entry.call.namespace", "route call references invalid ui namespace: ui"],
      ],
    },
    {
      invocation: {
        namespace: "contracts.App",
        function: "viewEntry",
        args: {
          "": "$account.address",
        },
      },
      allowedNamespaceTypes: CAM_ROUTE_CALL_NAMESPACE_TYPES,
      expected: [
        ["CAM_FACT_INVOCATION_ARG_NAME_INVALID", "routes.entry.call.args", "route call argument name must not be empty"],
      ],
    },
  ] as const

  for (const item of cases) {
    const result = collectCamInvocationFact({
      resource: "cam",
      path: "routes.entry.call",
      invocation: item.invocation,
      namespaceTypes,
      allowedNamespaceTypes: item.allowedNamespaceTypes,
      purpose: "route call",
    })
    assert.equal(result.value, undefined)
    assert.deepEqual(result.diagnostics.map((diagnostic) => [
      diagnostic.code,
      diagnostic.path,
      diagnostic.message,
    ]), item.expected)
  }

  assert.deepEqual(collectCamInvocationFact({
    resource: "cam",
    path: "routes.entry.then",
    invocation: {
      namespace: "routes",
      function: "entry",
      args: {},
    },
    namespaceTypes,
    allowedNamespaceTypes: CAM_READ_ROUTE_THEN_NAMESPACE_TYPES,
    purpose: "route continuation",
  }).diagnostics.map((diagnostic) => [
    diagnostic.code,
    diagnostic.path,
    diagnostic.message,
  ]), [
    ["CAM_FACT_INVOCATION_NAMESPACE_TYPE_INVALID", "routes.entry.then.namespace", "route continuation references invalid routes namespace: routes"],
  ])
})

test("collects route input declaration facts", () => {
  assert.deepEqual(collectCamRouteInputsFact({
    resource: "cam",
    path: "routes.entry.inputs",
    routeName: "entry",
    inputs: [],
  }), {
    value: {
      resource: "cam",
      path: "routes.entry.inputs",
      inputs: [],
    },
    diagnostics: [],
  })

  assert.deepEqual(collectCamRouteInputsFact({
    resource: "cam",
    path: "routes.component.inputs",
    routeName: "component",
    inputs: ["serialNumber", "owner"],
  }), {
    value: {
      resource: "cam",
      path: "routes.component.inputs",
      inputs: ["serialNumber", "owner"],
    },
    diagnostics: [],
  })
})

test("collects ordered route input declaration diagnostics", () => {
  const cases = [
    {
      inputs: null,
      expected: [
        ["CAM_FACT_ROUTE_INPUTS_NOT_ARRAY", "routes.entry.inputs", "route inputs must be an array: entry"],
      ],
    },
    {
      inputs: ["serialNumber", "", 1, "serial-number", "serialNumber"],
      expected: [
        ["CAM_FACT_ROUTE_INPUT_NAME_INVALID", "routes.entry.inputs.1", "route input name must be a non-empty string: entry"],
        ["CAM_FACT_ROUTE_INPUT_NAME_INVALID", "routes.entry.inputs.2", "route input name must be a non-empty string: entry"],
        ["CAM_FACT_ROUTE_INPUT_NAME_INVALID", "routes.entry.inputs.3", "route input name must be an expression identifier: serial-number"],
        ["CAM_FACT_ROUTE_INPUT_NAME_DUPLICATE", "routes.entry.inputs.4", "duplicate route input name: serialNumber"],
      ],
    },
  ] as const

  for (const item of cases) {
    const result = collectCamRouteInputsFact({
      resource: "cam",
      path: "routes.entry.inputs",
      routeName: "entry",
      inputs: item.inputs,
    })
    assert.equal(result.value, undefined)
    assert.deepEqual(result.diagnostics.map((diagnostic) => [
      diagnostic.code,
      diagnostic.path,
      diagnostic.message,
    ]), item.expected)
  }
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
  assert.equal(abiDynamicArrayElementType("uint256[]"), "uint256")
  assert.equal(abiDynamicArrayElementType("tuple[][]"), "tuple[]")
  assert.equal(abiDynamicArrayElementType("uint256[2]"), undefined)
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

test("owns ABI signature serialization used for overload references", () => {
  assert.equal(abiTupleArraySuffix("tuple"), "")
  assert.equal(abiTupleArraySuffix("tuple[]"), "[]")
  assert.equal(abiTupleArraySuffix("tuple[][2]"), "[][2]")
  assert.equal(abiTupleArraySuffix("tuple123"), undefined)
  assert.equal(abiTypeSignature({
    type: "tuple[]",
    components: [
      { type: "uint256" },
      {
        type: "tuple",
        components: [
          { type: "address" },
          { type: "string" },
        ],
      },
    ],
  }), "(uint256,(address,string))[]")
  assert.equal(abiTypeSignature({ type: "tuple" }), undefined)
  assert.equal(abiTypeSignature({
    type: "tuple",
    components: {} as unknown as [],
  }), undefined)
  assert.equal(abiFunctionSignature({
    name: "viewEntry",
    inputs: [
      { type: "address" },
      {
        type: "tuple[]",
        components: [
          { type: "uint256" },
          { type: "string" },
        ],
      },
    ],
  }), "viewEntry(address,(uint256,string)[])")
  assert.equal(abiFunctionSignature({
    name: "viewEntry",
    inputs: undefined as unknown as [],
  }), undefined)
})

test("owns ABI parameter name projection checks", () => {
  const inspected = inspectAbiParameterNames([
    { name: "owner", type: "address" },
    { type: "string" },
    { name: "owner", type: "address" },
    { name: "serialNumber", type: "string" },
  ])

  assert.deepEqual(inspected.entries.map(({ name, index }) => ({ name, index })), [
    { name: "owner", index: 0 },
    { name: "serialNumber", index: 3 },
  ])
  assert.deepEqual(inspected.issues, [
    { kind: "unnamed", index: 1 },
    { kind: "duplicate", name: "owner", index: 2 },
  ])
})

test("owns CAM-supported ABI function metadata grammar", () => {
  assert.equal(isAbiStateMutability("pure"), true)
  assert.equal(isAbiStateMutability("view"), true)
  assert.equal(isAbiStateMutability("nonpayable"), true)
  assert.equal(isAbiStateMutability("payable"), true)
  assert.equal(isAbiStateMutability("constant"), false)
})

test("owns expression identifier grammar", () => {
  assert.equal(isExpressionIdentifier("serialNumber"), true)
  assert.equal(isExpressionIdentifier("serial_number1"), true)
  assert.equal(isExpressionIdentifier("_serialNumber"), false)
  assert.equal(isExpressionIdentifier("serial-number"), false)
  assert.equal(isExpressionIdentifier("1serialNumber"), false)
})

test("owns expression reference grammar and escaping", () => {
  assert.equal(isExpressionArrayIndex("0"), true)
  assert.equal(isExpressionArrayIndex("10"), true)
  assert.equal(isExpressionArrayIndex(String(Number.MAX_SAFE_INTEGER)), true)
  assert.equal(isExpressionArrayIndex("9007199254740992"), false)
  assert.equal(isExpressionArrayIndex("01"), false)
  assert.equal(isExpressionArrayIndex("-1"), false)
  assert.equal(isExpressionReferenceString("$values.0.owner"), true)
  assert.equal(isExpressionReferenceString("values.0.owner"), false)
  assert.equal(isExpressionReferenceString("$$values.0.owner"), false)
  assert.equal(parseStaticExpressionString("values.0.owner"), "values.0.owner")
  assert.equal(parseStaticExpressionString("$$values.0.owner"), "$values.0.owner")
  assert.equal(parseStaticExpressionString("$values.0.owner"), undefined)
  assert.deepEqual(parseExpressionReference("$values.0.owner", { numericSegments: true }), {
    root: "values",
    segments: ["0", "owner"],
  })
  assert.equal(parseExpressionReference("$values.0.owner", { numericSegments: false }), undefined)
  assert.equal(parseExpressionReference("$values.9007199254740992.owner", { numericSegments: true }), undefined)
  assert.equal(parseExpressionReference("$values.", { numericSegments: true }), undefined)
  assert.equal(parseExpressionReference("$.values", { numericSegments: true }), undefined)
  assert.equal(parseExpressionReference("$$values.0.owner", { numericSegments: true }), undefined)
  assert.equal(expressionReferenceSyntaxError("literal", { numericSegments: true }), undefined)
  assert.equal(expressionReferenceSyntaxError("$values.0.owner", { numericSegments: true }), undefined)
  assert.equal(expressionReferenceSyntaxError("$values.", { numericSegments: true }), "invalid expression syntax: $values.")
})

test("collects expression reference occurrences with paths and syntax findings", () => {
  class NonProtocolBox {
    readonly value = "$account.address"
  }

  const occurrences = collectExpressionReferences({
    account: "$account.address",
    escaped: "$$account.address",
    invalid: "$values.",
    nested: ["$values.0.owner", "$values.9007199254740992.owner"],
    box: new NonProtocolBox(),
  }, { numericSegments: true })

  assert.deepEqual(occurrences, [
    {
      path: "account",
      value: "$account.address",
      reference: {
        root: "account",
        segments: ["address"],
      },
    },
    {
      path: "invalid",
      value: "$values.",
      syntaxError: "invalid expression syntax: $values.",
    },
    {
      path: "nested.0",
      value: "$values.0.owner",
      reference: {
        root: "values",
        segments: ["0", "owner"],
      },
    },
    {
      path: "nested.1",
      value: "$values.9007199254740992.owner",
      syntaxError: "invalid expression syntax: $values.9007199254740992.owner",
    },
  ])

  assert.deepEqual(
    collectExpressionReferences("$values.0.owner", { numericSegments: false }),
    [{
      path: "",
      value: "$values.0.owner",
      syntaxError: "invalid expression syntax: $values.0.owner",
    }],
  )
})

test("collects expression references without following object cycles", () => {
  const shared = { value: "$inputs.shared" }
  const cyclicRecord: Record<string, unknown> = {
    direct: "$inputs.direct",
    sharedA: shared,
    sharedB: shared,
  }
  cyclicRecord.self = cyclicRecord

  const cyclicArray: unknown[] = ["$inputs.array"]
  cyclicArray.push(cyclicArray)

  assert.deepEqual(
    collectExpressionReferences({
      cyclicRecord,
      cyclicArray,
    }, { numericSegments: true }),
    [
      {
        path: "cyclicRecord.direct",
        value: "$inputs.direct",
        reference: {
          root: "inputs",
          segments: ["direct"],
        },
      },
      {
        path: "cyclicRecord.sharedA.value",
        value: "$inputs.shared",
        reference: {
          root: "inputs",
          segments: ["shared"],
        },
      },
      {
        path: "cyclicRecord.sharedB.value",
        value: "$inputs.shared",
        reference: {
          root: "inputs",
          segments: ["shared"],
        },
      },
      {
        path: "cyclicArray.0",
        value: "$inputs.array",
        reference: {
          root: "inputs",
          segments: ["array"],
        },
      },
    ],
  )
})

test("collects route expression policy diagnostics", () => {
  const diagnostics = collectCamRouteExpressionDiagnostics({
    resource: "cam",
    value: {
      unsupportedRoot: "$state.serialNumber",
      undeclaredInput: "$inputs.missing",
      numericInput: "$inputs.0",
      earlyOutput: "$outputs.0",
      malformed: "$inputs.",
      escaped: "$$inputs.missing",
      literal: "serialNumber",
    },
    path: "routes.entry.call.args",
    declaredInputs: new Set(["serialNumber"]),
    allowOutputs: false,
    outputUnavailableMessage: "route call arguments cannot reference outputs before the call runs",
  })

  assert.deepEqual(diagnostics.map((diagnostic) => [
    diagnostic.code,
    diagnostic.path,
    diagnostic.message,
  ]), [
    ["CAM_FACT_ROUTE_EXPRESSION_ROOT_INVALID", "routes.entry.call.args.unsupportedRoot", "route expression root is not supported: state"],
    ["CAM_FACT_ROUTE_EXPRESSION_INPUT_UNDECLARED", "routes.entry.call.args.undeclaredInput", "route expression references undeclared input: missing"],
    ["CAM_FACT_ROUTE_EXPRESSION_INPUT_INVALID", "routes.entry.call.args.numericInput", "route expression input segment must be a declared name: 0"],
    ["CAM_FACT_ROUTE_EXPRESSION_OUTPUT_UNAVAILABLE", "routes.entry.call.args.earlyOutput", "route call arguments cannot reference outputs before the call runs"],
    ["CAM_FACT_ROUTE_EXPRESSION_SYNTAX_INVALID", "routes.entry.call.args.malformed", "invalid expression syntax: $inputs."],
  ])
})

test("collects route expression output diagnostics according to caller policy", () => {
  assert.deepEqual(collectCamRouteExpressionDiagnostics({
    resource: "cam",
    value: {
      view: "$outputs.0",
    },
    path: "routes.entry.then.args",
    declaredInputs: new Set(),
    allowOutputs: true,
    outputUnavailableMessage: "write route continuations cannot reference transaction outputs",
  }), [])

  assert.deepEqual(collectCamRouteExpressionDiagnostics({
    resource: "cam",
    value: {
      serialNumber: "$outputs.0",
    },
    path: "routes.save.then.args",
    declaredInputs: new Set(),
    allowOutputs: false,
    outputUnavailableMessage: "write route continuations cannot reference transaction outputs",
  }).map((diagnostic) => [
    diagnostic.code,
    diagnostic.path,
    diagnostic.message,
  ]), [
    ["CAM_FACT_ROUTE_EXPRESSION_OUTPUT_UNAVAILABLE", "routes.save.then.args.serialNumber", "write route continuations cannot reference transaction outputs"],
  ])
})

test("owns route and UI expression root vocabularies", () => {
  assert.deepEqual([...CAM_ROUTE_CONTEXT_KEYS], ["host", "account", "inputs", "outputs"])
  assert.deepEqual([...UI_CONTEXT_KEYS], ["host", "account", "inputs", "outputs", "state", "view"])
  assert.deepEqual([...UI_RUNTIME_ROOTS], ["host", "account", "inputs", "outputs", "state"])
})

test("diffs exact name-set contracts in diagnostic order", () => {
  const findings: string[] = []
  diffNameSets({
    expectedNames: ["view", "serialNumber"],
    actualNames: ["extra", "view"],
    onUnexpected: (name) => findings.push(`unexpected:${name}`),
    onMissing: (name) => findings.push(`missing:${name}`),
  })
  assert.deepEqual(findings, ["unexpected:extra", "missing:serialNumber"])
})

test("reports ordered name-list shape issues without owning diagnostics", () => {
  assert.deepEqual(nameListShapeIssues(["view", "", "view", "", "view"]), [
    { kind: "empty", index: 1 },
    { kind: "duplicate", name: "view", index: 2 },
    { kind: "empty", index: 3 },
    { kind: "duplicate", name: "view", index: 4 },
  ])
})

test("owns UI call-edge namespace wiring", () => {
  assert.deepEqual(UI_CALL_NAMESPACE_BY_ELEMENT, {
    Include: "ui",
    Button: "routes",
  })
  assert.equal(uiCallNamespaceForElement("Include"), "ui")
  assert.equal(uiCallNamespaceForElement("Button"), "routes")
  assert.equal(uiCallNamespaceForElement("Text"), undefined)
})

test("owns UI prop semantic buckets", () => {
  assert.equal(isUiPropElement("Text"), true)
  assert.equal(isUiPropElement("Button"), true)
  assert.equal(isUiPropElement("Fragment"), false)
  assert.equal(isUiPropElement("Include"), false)

  for (const [element, schema] of Object.entries(UI_PROP_SCHEMAS)) {
    for (const prop of schema.address) {
      assert.ok(
        (schema.string as readonly string[]).includes(prop),
        `${element}.${prop}: address props must also be string props`,
      )
    }
  }

  // These are deliberately display values, not syntactic string props.
  // Renderers may format inert values, while the resolver keeps labels and
  // addresses on stricter semantic rails.
  assert.ok((UI_PROP_SCHEMAS.Status.required as readonly string[]).includes("value"))
  assert.equal((UI_PROP_SCHEMAS.Status.string as readonly string[]).includes("value"), false)
  assert.ok((UI_PROP_SCHEMAS.Nft.required as readonly string[]).includes("tokenId"))
  assert.equal((UI_PROP_SCHEMAS.Nft.string as readonly string[]).includes("tokenId"), false)
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

  const shared = { owner: "$values.0.owner" }
  assert.deepEqual(
    runtime.parsePayload({ first: shared, second: shared }, "payload"),
    { first: shared, second: shared },
  )

  const cyclicPayload: Record<string, unknown> = {}
  cyclicPayload.self = cyclicPayload
  assert.throws(
    () => runtime.parsePayload(cyclicPayload, "payload"),
    /payload\.self: expected a JSON value/,
  )

  const cyclicValue: Record<string, unknown> = {}
  cyclicValue.self = cyclicValue
  assert.throws(
    () => runtime.resolveValue(cyclicValue, {}, "field"),
    /field\.self: expected a JSON value/,
  )
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
  assert.throws(
    () => parseJsonBytes(new Uint8Array([0x7b, 0x22, 0xff, 0x22, 0x3a, 0x31, 0x7d])),
    /encoded data/,
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
  assert.throws(() => requireHttpURL("not a url", "uri"), /uri: expected absolute URL/)
  assert.throws(() => requireHttpURL({ toString: () => "https://example.test" } as unknown as string, "uri"), /non-empty URI string/)
  assert.throws(() => requireHttpURL("ftp://example.test/x", "uri"), /http/)
  assert.throws(() => requireHttpURL("https://user@example.test/x", "uri"), /credentials/)
  assert.throws(() => requireHttpURL("https://example.test/\\evil", "uri"), /unsafe raw characters/)
  assert.throws(() => requireHttpURL("https://example.test/a\nb", "uri"), /unsafe raw characters/)
  assert.throws(() => requireHttpOrigin("https://example.test/path", "origin"), /origin/)
  assert.throws(() => requireSameHttpOrigin("https://other.test/x", "https://example.test", "uri"), /outside/)
  assert.equal(responseContentLength(new Response("", { headers: { "content-length": "3" } }), "uri"), 3)
  assert.throws(
    () => responseContentLength(new Response("", { headers: { "content-length": "9007199254740993" } }), "uri"),
    /invalid Content-Length/,
  )

  const small = await readBoundedResponseBytes(new Response("abc", {
    headers: {
      "content-length": "3",
    },
  }), "https://example.test/x", 3)
  assert.equal(new TextDecoder().decode(small), "abc")

  const fetched: Array<{
    readonly href: string
    readonly redirect: string
    readonly cache?: string
  }> = []
  const loadResource = createSameOriginHttpResourceLoader({
    originInput: "https://example.test",
    originLabel: "origin",
    loadFailurePrefix: "load failed",
    cache: "no-store",
    async fetchResource(href, init) {
      fetched.push(init.cache === undefined
        ? { href, redirect: init.redirect }
        : { href, redirect: init.redirect, cache: init.cache })
      return new Response("resource")
    },
  })
  assert.equal(
    new TextDecoder().decode(await loadResource("https://example.test/cam/ui.json")),
    "resource",
  )
  assert.deepEqual(fetched, [{
    href: "https://example.test/cam/ui.json",
    redirect: "error",
    cache: "no-store",
  }])
  await assert.rejects(
    () => loadResource("https://other.test/cam/ui.json"),
    /outside allowed origin/,
  )
  await assert.rejects(
    () => createSameOriginHttpResourceLoader({
      originInput: "https://example.test",
      originLabel: "origin",
      loadFailurePrefix: "load failed",
      async fetchResource() {
        return new Response("missing", { status: 404 })
      },
    })("https://example.test/missing.json"),
    /load failed https:\/\/example\.test\/missing\.json: HTTP 404/,
  )

  let released = false
  const releasedBytes = await readBoundedResponseBytes({
    body: {
      getReader() {
        let read = false
        return {
          async read() {
            if (read) return { done: true }
            read = true
            return { done: false, value: new TextEncoder().encode("ok") }
          },
          releaseLock() {
            released = true
            throw new Error("release failed")
          },
        }
      },
    },
    headers: {
      get() {
        return null
      },
    },
  }, "https://example.test/x", 3)
  assert.equal(new TextDecoder().decode(releasedBytes), "ok")
  assert.equal(released, true)

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
    () => readBoundedResponseBytes(new Response("abc", {
      headers: {
        "content-encoding": "gzip",
      },
    }), "https://example.test/x", 3),
    /must not use HTTP content encoding/,
  )

  await assert.rejects(
    () => readBoundedResponseBytes({
      body: {
        getReader() {
          let read = false
          return {
            async read() {
              if (read) return { done: true }
              read = true
              return { done: false, value: new TextEncoder().encode("ok") }
            },
          }
        },
      },
      headers: {
        get(name) {
          return name.toLowerCase() === "content-length" ? "3" : null
        },
      },
    }, "https://example.test/x", 3),
    /ended before Content-Length/,
  )

  let cancelledAfterContentLength = false
  await assert.rejects(
    () => readBoundedResponseBytes({
      body: {
        getReader() {
          let read = false
          return {
            async read() {
              if (read) return { done: true }
              read = true
              return { done: false, value: new TextEncoder().encode("toolong") }
            },
            async cancel() {
              cancelledAfterContentLength = true
            },
          }
        },
      },
      headers: {
        get(name) {
          return name.toLowerCase() === "content-length" ? "3" : null
        },
      },
    }, "https://example.test/x", 10),
    /exceeded Content-Length/,
  )
  assert.equal(cancelledAfterContentLength, true)

  await assert.rejects(
    () => readBoundedResponseBytes({
      body: {
        getReader() {
          return {
            async read() {
              return { done: false, value: new Uint8Array(4) }
            },
            async cancel() {
              throw new Error("cancel failed")
            },
          }
        },
      },
      headers: {
        get() {
          return null
        },
      },
    }, "https://example.test/x", 3),
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
    /non-byte chunk/,
  )

  await assert.rejects(
    () => readBoundedResponseBytes({
      body: {
        getReader() {
          return {
            async read() {
              return { done: false, value: new ArrayBuffer(1) as unknown as Uint8Array }
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
    /non-byte chunk/,
  )

  await assert.rejects(
    () => readBoundedResponseBytes({
      body: {
        getReader() {
          return {
            async read() {
              return { done: false, value: new Uint8Array() }
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

test("validates published CAM root URI policy", () => {
  assert.doesNotThrow(() => assertPublishedCamRootURI("https://example.test/cam/main.json", "CAM URI"))
  assert.doesNotThrow(() => assertPublishedCamRootURI("ipfs://QmYwAPJzv5CZsnAzt8auVZRnJQt6P2JxC1ZyQ3GzFZ2q6x/main.json", "CAM URI"))

  for (const uri of [
    "./cam/main.json",
    "file:///bundle/main.json",
    { toString: () => "https://example.test/cam/main.json" } as unknown as string,
    "http://example.test/cam/main.json",
    "https://user@example.test/cam/main.json",
    "https://example.test/\\main.json",
    "ipfs://example/main.json",
  ]) {
    assert.throws(
      () => assertPublishedCamRootURI(uri, "CAM URI"),
      /CAM URI:/,
    )
  }
})

test("validates loadable CAM root URI policy", () => {
  assert.doesNotThrow(() => assertLoadableCamRootURI("http://bike-nft-cam-http:8080/main.json", "CAM URI"))
  assert.doesNotThrow(() => assertLoadableCamRootURI("https://example.test/cam/main.json", "CAM URI"))
  assert.doesNotThrow(() => assertLoadableCamRootURI("ipfs://QmYwAPJzv5CZsnAzt8auVZRnJQt6P2JxC1ZyQ3GzFZ2q6x/main.json", "CAM URI"))

  for (const uri of [
    "./cam/main.json",
    "file:///bundle/main.json",
    "javascript:alert(1)",
    "https://user@example.test/cam/main.json",
    "https://example.test/a\nb",
    "ipfs://example/main.json",
  ]) {
    assert.throws(
      () => assertLoadableCamRootURI(uri, "CAM URI"),
      /CAM URI:/,
    )
  }
})

test("resolves CAM resource URIs independently from loader policy", () => {
  assert.equal(resolveCamResourceURI("ipfs://example/main.json", "./ui.json"), "ipfs://example/ui.json")
  assert.equal(resolveCamResourceURI("ipfs://example/cam/main.json", "./abi/App.json"), "ipfs://example/cam/abi/App.json")
  assert.equal(
    resolveCamResourceURI("https://example.test/cam/main.json?version=1#root", "./ui.json#node"),
    "https://example.test/cam/ui.json#node",
  )
  assert.equal(resolveCamResourceURI("./cam/main.json", "./ui.json"), "./cam/ui.json")
  assert.equal(resolveCamResourceURI("file:///bundle/root.json", "./ui.json"), "file:///bundle/ui.json")
  assert.equal(resolveCamResourceURI("ipfs://example/main.json", "ipfs://other/ui.json"), "ipfs://other/ui.json")
  assert.throws(() => resolveCamResourceURI("ipfs://example/main.json", "//example.test/ui.json"), /scheme-relative/)
  assert.throws(() => resolveCamResourceURI("urn:cam:root", "./ui.json"), /hierarchical/)
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
