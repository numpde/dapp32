import assert from "node:assert/strict"
import test from "node:test"
import {
  CAM_RESOURCE_MAX_BYTES,
} from "@cam/protocol"

import {
  assertCamBundle,
  validateCamBundle,
} from "../src/index.ts"
import {
  abiIssueLocationsFor,
  duplicateViewEntrySignatureAbiBytes,
  issueLocations,
  issueRules,
  jsonBytes,
  minimalBundle,
  mustGetResource,
  overloadedViewEntryAbiBytes,
  replaceBundleResources,
  sha256Integrity,
  validateEditedRoot,
  viewOutput,
} from "./fixtures.ts"

const encoder = new TextEncoder()

test("valid minimal bundle returns no issues", () => {
  assert.deepEqual(validateCamBundle(minimalBundle()), [])
  assert.doesNotThrow(() => assertCamBundle(minimalBundle()))
})

test("missing declared UI resource returns one precise issue", () => {
  const bundle = minimalBundle()
  const resources = new Map(bundle.resources)
  resources.delete("./ui.json")

  assert.deepEqual(validateCamBundle({
    ...bundle,
    resources,
  }), [
    {
      rule: "CAM_RESOURCE_MISSING",
      severity: "error",
      resource: "./ui.json",
      path: "namespaces.ui.uri",
      message: "declared CAM resource is missing: ./ui.json",
    },
  ])
})

test("malformed declared UI document inventory is reported before runtime compatibility", () => {
  const uiBytes = jsonBytes({
    ui: "1.0.0",
    nodes: null,
  })
  const issues = validateEditedRoot<{
    readonly namespaces: Record<string, Record<string, unknown>>
  }>((root, bundle) => {
    return replaceBundleResources(root, bundle, { uiBytes })
  })

  assert.deepEqual(issueLocations(issues), [
    ["CAM_UI_DOCUMENT_INVALID", "nodes"],
  ])
})

test("empty UI node inventory is reported as a document issue", () => {
  const uiBytes = jsonBytes({
    ui: "1.0.0",
    nodes: {},
  })
  const issues = validateEditedRoot<{
    readonly namespaces: Record<string, Record<string, unknown>>
  }>((root, bundle) => {
    return replaceBundleResources(root, bundle, { uiBytes })
  })

  assert.deepEqual(issueLocations(issues), [
    ["CAM_UI_DOCUMENT_INVALID", "nodes"],
  ])
})

test("empty UI node names are reported as node inventory issues", () => {
  const uiBytes = jsonBytes({
    ui: "1.0.0",
    nodes: {
      "": {
        tag: "Text",
        requires: ["view"],
        props: {
          text: "$view.title",
        },
      },
    },
  })
  const issues = validateEditedRoot<{
    readonly namespaces: Record<string, Record<string, unknown>>
  }>((root, bundle) => {
    return replaceBundleResources(root, bundle, { uiBytes })
  })

  assert.deepEqual(issueLocations(issues), [
    ["CAM_UI_NODE_INTERFACE_INVALID", "nodes"],
    ["CAM_ROUTE_HANDOFF_MISMATCH", "routes.entry.then.function"],
    ["CAM_UI_FIELD_INVALID", "nodes"],
  ])
})

test("invalid root CAM bytes report the caller-supplied root URI", () => {
  const issues = validateCamBundle({
    ...minimalBundle(),
    rootURI: "ipfs://example-cid/app.cam",
    rootBytes: encoder.encode("{"),
  })

  assert.equal(issues.length, 1)
  assert.equal(issues[0]?.rule, "CAM_ROOT_JSON_INVALID")
  assert.equal(issues[0]?.resource, "ipfs://example-cid/app.cam")
})

test("root CAM bytes must not exceed the runtime resource size cap", () => {
  const rootBytes = new Uint8Array(CAM_RESOURCE_MAX_BYTES + 1)
  const issues = validateCamBundle({
    ...minimalBundle(),
    rootURI: "ipfs://example-cid/app.cam",
    rootBytes,
  })

  assert.deepEqual(issues, [
    {
      rule: "CAM_RESOURCE_TOO_LARGE",
      severity: "error",
      resource: "ipfs://example-cid/app.cam",
      message: `CAM resource is too large: ipfs://example-cid/app.cam has ${rootBytes.byteLength} bytes; limit is ${CAM_RESOURCE_MAX_BYTES}`,
    },
  ])
})

test("runtime CAM parsing is reported after resource checks", () => {
  const issues = validateEditedRoot((root, bundle) => {
    delete root.entry
    return {
      resources: new Map([
        ["./abi/App.json", mustGetResource(bundle, "./abi/App.json")],
      ]),
    }
  })

  assert.deepEqual(issueRules(issues), [
    "CAM_RESOURCE_MISSING",
    "CAM_ENTRY_ROUTE_INVALID",
    "CAM_RUNTIME_CAM_INVALID",
  ])
})

test("malformed entry route is reported before runtime compatibility", () => {
  const issues = validateEditedRoot((root) => {
    root.entry = ""
  })

  assert.deepEqual(issueLocations(issues), [
    ["CAM_ENTRY_ROUTE_INVALID", "entry"],
    ["CAM_RUNTIME_CAM_INVALID", "entry"],
  ])
})

test("missing entry route is reported as a precise manifest issue", () => {
  const issues = validateEditedRoot((root) => {
    root.entry = "missing"
  })

  assert.deepEqual(issueLocations(issues), [
    ["CAM_ENTRY_ROUTE_MISSING", "entry"],
    ["CAM_RUNTIME_CAM_INVALID", "entry"],
  ])
})

test("malformed route inventory is reported before runtime compatibility", () => {
  const issues = validateEditedRoot((root) => {
    root.routes = null
  })

  assert.deepEqual(issueLocations(issues), [
    ["CAM_ROUTE_DECLARATION_INVALID", "routes"],
    ["CAM_RUNTIME_CAM_INVALID", "routes"],
  ])
})

test("malformed route declarations are reported before runtime compatibility", () => {
  const issues = validateEditedRoot<{
    readonly routes: Record<string, unknown>
  }>((root) => {
    root.routes[""] = {
      kind: "read",
      inputs: [],
      call: {},
      then: {},
    }
    root.routes.broken = null
  })

  assert.deepEqual(issueLocations(issues), [
    ["CAM_ROUTE_DECLARATION_INVALID", "routes"],
    ["CAM_ROUTE_DECLARATION_INVALID", "routes.broken"],
    ["CAM_RUNTIME_CAM_INVALID", "routes"],
  ])
})

test("unknown CAM manifest fields use an author-facing conformance rule", () => {
  const issues = validateEditedRoot<Record<string, unknown>>((root) => {
    root.unexpected = true
  })

  assert.deepEqual(issueLocations(issues), [
    ["CAM_MANIFEST_FIELD_UNKNOWN", "unexpected"],
  ])
})

test("invalid route kind is reported directly", () => {
  const issues = validateEditedRoot<{
    readonly routes: Record<string, unknown>
  }>((root) => {
    const entry = root.routes.entry as Record<string, unknown>
    entry.kind = "browse"
  })

  assert.deepEqual(issueLocations(issues), [
    ["CAM_ROUTE_KIND_INVALID", "routes.entry.kind"],
    ["CAM_RUNTIME_CAM_INVALID", "routes.entry.kind"],
  ])
})

test("invalid route input declarations are reported per input", () => {
  const issues = validateEditedRoot<{
    readonly routes: Record<string, unknown>
  }>((root) => {
    root.routes.entry = {
      kind: "read",
      inputs: ["serialNumber", "", "serial-number", "serialNumber"],
      call: {
        namespace: "contracts.App",
        function: "viewEntry",
        args: {},
      },
      then: {
        namespace: "ui",
        function: "app",
        args: {
          view: "$outputs.0",
        },
      },
    }
  })

  assert.deepEqual(issueLocations(issues), [
    ["CAM_ROUTE_INPUTS_INVALID", "routes.entry.inputs.1"],
    ["CAM_ROUTE_INPUTS_INVALID", "routes.entry.inputs.2"],
    ["CAM_ROUTE_INPUTS_INVALID", "routes.entry.inputs.3"],
    ["CAM_RUNTIME_CAM_INVALID", "routes.entry.inputs.1"],
  ])
})

test("route expressions must reference declared route inputs", () => {
  const issues = validateEditedRoot<{
    readonly routes: Record<string, Record<string, unknown>>
  }>((root) => {
    root.routes.entry = {
      kind: "read",
      inputs: ["serialNumber"],
      call: {
        namespace: "contracts.App",
        function: "viewEntry",
        args: {
          serialNumber: "$inputs.misspelledSerialNumber",
        },
      },
      then: {
        namespace: "ui",
        function: "app",
        args: {
          view: "$outputs.0",
          serialNumber: "$inputs.misspelledSerialNumber",
        },
      },
    }
  })

  assert.deepEqual(issueLocations(issues), [
    ["CAM_ROUTE_EXPRESSION_INVALID", "routes.entry.call.args.serialNumber"],
    ["CAM_ROUTE_EXPRESSION_INVALID", "routes.entry.then.args.serialNumber"],
    ["CAM_ROUTE_HANDOFF_MISMATCH", "routes.entry.then.args.serialNumber"],
    ["CAM_ROUTE_ABI_MISMATCH", "routes.entry.call.args.serialNumber"],
  ])
})

test("route call expressions cannot reference outputs before the call runs", () => {
  const issues = validateEditedRoot<{
    readonly routes: Record<string, Record<string, unknown>>
  }>((root) => {
    root.routes.entry.call = {
      namespace: "contracts.App",
      function: "viewEntry",
      args: {
        previous: "$outputs.0",
      },
    }
  })

  assert.deepEqual(issueLocations(issues), [
    ["CAM_ROUTE_EXPRESSION_INVALID", "routes.entry.call.args.previous"],
    ["CAM_ROUTE_ABI_MISMATCH", "routes.entry.call.args.previous"],
  ])
})

test("route expressions must use route context roots", () => {
  const abiBytes = jsonBytes([
    {
      type: "function",
      name: "viewEntry",
      stateMutability: "view",
      inputs: [
        {
          name: "serialNumber",
          type: "string",
        },
        {
          name: "tokenURI",
          type: "string",
        },
      ],
      outputs: [viewOutput()],
    },
  ])
  const issues = validateEditedRoot<{
    readonly namespaces: Record<string, Record<string, unknown>>
    readonly routes: Record<string, Record<string, unknown>>
  }>((root, bundle) => {
    root.routes.entry.inputs = ["serialNumber", "tokenURI"]
    root.routes.entry.call = {
      namespace: "contracts.App",
      function: "viewEntry",
      args: {
        serialNumber: "$state.serialNumber",
        tokenURI: "$inputs.",
      },
    }
    return replaceBundleResources(root, bundle, { abiBytes })
  })

  assert.deepEqual(issueLocations(issues), [
    ["CAM_ROUTE_EXPRESSION_INVALID", "routes.entry.call.args.serialNumber"],
    ["CAM_ROUTE_EXPRESSION_INVALID", "routes.entry.call.args.tokenURI"],
    ["CAM_RUNTIME_CAM_INVALID", "routes.entry.call.args.serialNumber"],
  ])
})

test("write route continuations cannot reference transaction outputs", () => {
  const abiBytes = jsonBytes([
    {
      type: "function",
      name: "viewEntry",
      stateMutability: "view",
      inputs: [],
      outputs: [viewOutput()],
    },
    {
      type: "function",
      name: "save",
      stateMutability: "nonpayable",
      inputs: [],
      outputs: [
        {
          name: "serialNumber",
          type: "string",
        },
      ],
    },
  ])
  const issues = validateEditedRoot<{
    readonly namespaces: Record<string, Record<string, unknown>>
    readonly routes: Record<string, Record<string, unknown>>
  }>((root, bundle) => {
    root.routes.entry.inputs = ["serialNumber"]
    root.routes.save = {
      kind: "write",
      inputs: [],
      call: {
        namespace: "contracts.App",
        function: "save",
        args: {},
      },
      then: {
        namespace: "routes",
        function: "entry",
        args: {
          serialNumber: "$outputs.0",
        },
      },
    }
    return replaceBundleResources(root, bundle, { abiBytes })
  })

  assert.deepEqual(issueLocations(issues), [
    ["CAM_ROUTE_EXPRESSION_INVALID", "routes.save.then.args.serialNumber"],
  ])
})

test("route invocations must target the correct namespace types", () => {
  const issues = validateEditedRoot<{
    readonly routes: Record<string, unknown>
  }>((root) => {
    root.routes.entry = {
      kind: "read",
      inputs: [],
      call: {
        namespace: "ui",
        function: "viewEntry",
        args: {},
      },
      then: {
        namespace: "contracts.App",
        function: "app",
        args: {
          view: "$outputs.0",
        },
      },
    }
  })

  assert.deepEqual(issueLocations(issues), [
    ["CAM_ROUTE_INVOCATION_INVALID", "routes.entry.call.namespace"],
    ["CAM_ROUTE_INVOCATION_INVALID", "routes.entry.then.namespace"],
    ["CAM_RUNTIME_CAM_INVALID", "routes.entry.call.namespace"],
  ])
})

test("route invocations require function names and named args", () => {
  const issues = validateEditedRoot<{
    readonly routes: Record<string, unknown>
  }>((root) => {
    root.routes.entry = {
      kind: "read",
      inputs: [],
      call: {
        namespace: "contracts.App",
        function: "",
        args: [],
      },
      then: {
        namespace: "ui",
        args: null,
      },
    }
  })

  assert.deepEqual(issueLocations(issues), [
    ["CAM_ROUTE_INVOCATION_INVALID", "routes.entry.call.function"],
    ["CAM_ROUTE_INVOCATION_INVALID", "routes.entry.call.args"],
    ["CAM_ROUTE_INVOCATION_INVALID", "routes.entry.then.function"],
    ["CAM_ROUTE_INVOCATION_INVALID", "routes.entry.then.args"],
    ["CAM_RUNTIME_CAM_INVALID", "routes.entry.call.function"],
  ])
})

test("route invocation arg names must not be empty", () => {
  const issues = validateEditedRoot<{
    readonly routes: Record<string, Record<string, unknown>>
  }>((root) => {
    root.routes.entry.call = {
      namespace: "contracts.App",
      function: "viewEntry",
      args: {
        "": "$account.address",
      },
    }
    root.routes.entry.then = {
      namespace: "ui",
      function: "app",
      args: {
        "": "$outputs.0",
      },
    }
  })

  assert.deepEqual(issueLocations(issues), [
    ["CAM_ROUTE_INVOCATION_INVALID", "routes.entry.call.args"],
    ["CAM_ROUTE_INVOCATION_INVALID", "routes.entry.then.args"],
    ["CAM_RUNTIME_CAM_INVALID", "routes.entry.call.args"],
  ])
})

test("route calls must target functions declared by the namespace ABI", () => {
  const issues = validateEditedRoot<{
    readonly routes: Record<string, Record<string, unknown>>
  }>((root) => {
    const entry = root.routes.entry
    entry.call = {
      namespace: "contracts.App",
      function: "missing",
      args: {},
    }
  })

  assert.deepEqual(issueLocations(issues), [
    ["CAM_ROUTE_ABI_MISMATCH", "routes.entry.call"],
  ])
})

test("overloaded route functions require a full signature", () => {
  const abiBytes = overloadedViewEntryAbiBytes()
  const issues = validateEditedRoot<{
    readonly namespaces: Record<string, Record<string, unknown>>
  }>((root, bundle) => {
    return replaceBundleResources(root, bundle, { abiBytes })
  })

  assert.deepEqual(issueLocations(issues), [
    ["CAM_ROUTE_ABI_MISMATCH", "routes.entry.call.function"],
  ])
})

test("full route function signatures disambiguate overloads", () => {
  const abiBytes = overloadedViewEntryAbiBytes()
  const issues = validateEditedRoot<{
    readonly namespaces: Record<string, Record<string, unknown>>
    readonly routes: Record<string, Record<string, unknown>>
  }>((root, bundle) => {
    const entry = root.routes.entry
    const call = entry.call as Record<string, unknown>
    call.function = "viewEntry()"
    return replaceBundleResources(root, bundle, { abiBytes })
  })

  assert.deepEqual(issues, [])
})

test("route function references must be names or full signatures", () => {
  const issues = validateEditedRoot<{
    readonly routes: Record<string, Record<string, unknown>>
  }>((root) => {
    root.routes.entry.call = {
      namespace: "contracts.App",
      function: "viewEntry(address",
      args: {},
    }
  })

  assert.deepEqual(issueLocations(issues), [
    ["CAM_ROUTE_ABI_MISMATCH", "routes.entry.call.function"],
  ])
})

test("ABI resource validation rejects runtime-invalid function ABI shapes", () => {
  assert.deepEqual(abiIssueLocationsFor(duplicateViewEntrySignatureAbiBytes()), [
    ["CAM_ABI_INVALID", "1"],
  ])

  assert.deepEqual(abiIssueLocationsFor(jsonBytes([
    {
      name: "viewEntry",
    },
    {
      type: "",
      name: "viewEntry",
    },
  ])), [
    ["CAM_ABI_INVALID", "0.type"],
    ["CAM_ABI_INVALID", "1.type"],
  ])

  assert.deepEqual(abiIssueLocationsFor(jsonBytes([
    {
      type: "function",
      name: "view-entry",
      stateMutability: "view",
      inputs: [],
      outputs: [],
    },
  ])), [
    ["CAM_ABI_INVALID", "0.name"],
  ])

  assert.deepEqual(abiIssueLocationsFor(jsonBytes([
    {
      type: "function",
      name: "viewEntry",
      stateMutability: "view",
      inputs: [
        {
          name: "broken",
          type: "uint257[]",
        },
      ],
      outputs: [
        {
          name: "broken",
          type: "bytes33",
        },
      ],
    },
  ])), [
    ["CAM_ABI_INVALID", "0.inputs.0"],
    ["CAM_ABI_INVALID", "0.outputs.0"],
  ])

  assert.deepEqual(abiIssueLocationsFor(jsonBytes([
    {
      type: "function",
      name: "viewEntry",
      stateMutability: "view",
      inputs: [
        {
          name: "broken",
          type: "uint256[2][]",
        },
      ],
      outputs: [viewOutput()],
    },
  ])), [
    ["CAM_ABI_INVALID", "0.inputs.0"],
  ])

  assert.deepEqual(abiIssueLocationsFor(jsonBytes([
    {
      type: "function",
      name: "viewEntry",
      stateMutability: "view",
      inputs: [
        {
          name: "inputTuple",
          type: "tuple",
          components: [
            {
              type: "string",
            },
          ],
        },
      ],
      outputs: [
        {
          name: "outputTuple",
          type: "tuple",
          components: [
            {
              type: "string",
            },
          ],
        },
      ],
    },
  ])), [
    ["CAM_ABI_INVALID", "0.inputs.0.components.0.name"],
    ["CAM_ABI_INVALID", "0.outputs.0.components.0.name"],
  ])

  assert.deepEqual(abiIssueLocationsFor(jsonBytes([
    {
      type: "function",
      name: "viewEntry",
      stateMutability: "view",
      inputs: [
        {
          name: "amount",
          type: "uint256",
        },
        {
          name: "amount",
          type: "uint256",
        },
      ],
      outputs: [],
    },
  ])), [
    ["CAM_ABI_INVALID", "0.inputs.1.name"],
  ])

  assert.deepEqual(abiIssueLocationsFor(jsonBytes([
    {
      type: "function",
      name: "viewEntry",
      stateMutability: "view",
      inputs: [
        {
          name: "input",
          type: "tuple",
          components: [
            {
              name: "amount",
              type: "uint256",
            },
            {
              name: "amount",
              type: "uint256",
            },
          ],
        },
      ],
      outputs: [
        {
          name: "view",
          type: "tuple",
          components: [
            {
              name: "amount",
              type: "uint256",
            },
            {
              name: "amount",
              type: "uint256",
            },
          ],
        },
      ],
    },
  ])), [
    ["CAM_ABI_INVALID", "0.inputs.0.components.1.name"],
    ["CAM_ABI_INVALID", "0.outputs.0.components.1.name"],
  ])
})

test("route call args must match named ABI inputs exactly", () => {
  const abiBytes = jsonBytes([
    {
      type: "function",
      name: "viewEntry",
      stateMutability: "view",
      inputs: [
        {
          name: "account",
          type: "address",
        },
      ],
      outputs: [viewOutput()],
    },
  ])
  const issues = validateEditedRoot<{
    readonly namespaces: Record<string, Record<string, unknown>>
    readonly routes: Record<string, Record<string, unknown>>
  }>((root, bundle) => {
    root.routes.entry.call = {
      namespace: "contracts.App",
      function: "viewEntry",
      args: {
        extra: "$account.address",
      },
    }
    return replaceBundleResources(root, bundle, { abiBytes })
  })

  assert.deepEqual(issueLocations(issues), [
    ["CAM_ROUTE_ABI_MISMATCH", "routes.entry.call.args.extra"],
    ["CAM_ROUTE_ABI_MISMATCH", "routes.entry.call.args.account"],
  ])
})

test("route call args with statically classified expression roots must match ABI scalar types", () => {
  const abiBytes = jsonBytes([
    {
      type: "function",
      name: "viewEntry",
      stateMutability: "view",
      inputs: [
        {
          name: "account",
          type: "address",
        },
      ],
      outputs: [viewOutput()],
    },
  ])
  const issues = validateEditedRoot<{
    readonly namespaces: Record<string, Record<string, unknown>>
    readonly routes: Record<string, Record<string, unknown>>
  }>((root, bundle) => {
    root.routes.entry.call = {
      namespace: "contracts.App",
      function: "viewEntry",
      args: {
        account: "$host.chainId",
      },
    }
    return replaceBundleResources(root, bundle, { abiBytes })
  })

  assert.deepEqual(issueLocations(issues), [
    ["CAM_ROUTE_ABI_MISMATCH", "routes.entry.call.args.account"],
  ])
})

test("route call literal strings defer integer and address exactness to runtime", () => {
  const abiBytes = jsonBytes([
    {
      type: "function",
      name: "viewEntry",
      stateMutability: "view",
      inputs: [
        {
          name: "active",
          type: "bool",
        },
        {
          name: "count",
          type: "uint256",
        },
        {
          name: "owner",
          type: "address",
        },
      ],
      outputs: [viewOutput()],
    },
  ])
  const issues = validateEditedRoot<{
    readonly namespaces: Record<string, Record<string, unknown>>
    readonly routes: Record<string, Record<string, unknown>>
  }>((root, bundle) => {
    root.routes.entry.call = {
      namespace: "contracts.App",
      function: "viewEntry",
      args: {
        active: "true",
        count: "1",
        owner: "runtime-validates-address-literals",
      },
    }
    return replaceBundleResources(root, bundle, { abiBytes })
  })

  assert.deepEqual(issueLocations(issues), [
    ["CAM_ROUTE_ABI_MISMATCH", "routes.entry.call.args.active"],
  ])
})

test("string route args reject known non-string literals", () => {
  const abiBytes = jsonBytes([
    {
      type: "function",
      name: "viewEntry",
      stateMutability: "view",
      inputs: [
        {
          name: "serialNumber",
          type: "string",
        },
      ],
      outputs: [viewOutput()],
    },
  ])
  const issues = validateEditedRoot<{
    readonly namespaces: Record<string, Record<string, unknown>>
    readonly routes: Record<string, Record<string, unknown>>
  }>((root, bundle) => {
    root.routes.entry.call = {
      namespace: "contracts.App",
      function: "viewEntry",
      args: {
        serialNumber: 123,
      },
    }
    return replaceBundleResources(root, bundle, { abiBytes })
  })

  assert.deepEqual(issueLocations(issues), [
    ["CAM_ROUTE_ABI_MISMATCH", "routes.entry.call.args.serialNumber"],
  ])
})

test("route continuations must reference ABI-declared output indexes", () => {
  const abiBytes = jsonBytes([
    {
      type: "function",
      name: "viewEntry",
      stateMutability: "view",
      inputs: [],
      outputs: [],
    },
  ])
  const issues = validateEditedRoot<{
    readonly namespaces: Record<string, Record<string, unknown>>
  }>((root, bundle) => {
    return replaceBundleResources(root, bundle, { abiBytes })
  })

  assert.deepEqual(issueLocations(issues), [
    ["CAM_ROUTE_ABI_MISMATCH", "routes.entry.then.args.view"],
  ])
})

test("route continuations must reference ABI-declared tuple fields", () => {
  const issues = validateEditedRoot<{
    readonly routes: Record<string, Record<string, unknown>>
  }>((root) => {
    root.routes.entry.then = {
      namespace: "ui",
      function: "app",
      args: {
        view: "$outputs.0.missingTitle",
      },
    }
  })

  assert.deepEqual(issueLocations(issues), [
    ["CAM_ROUTE_ABI_MISMATCH", "routes.entry.then.args.view"],
  ])
})

test("read route continuations must target declared UI nodes with exact args", () => {
  const issues = validateEditedRoot<{
    readonly routes: Record<string, Record<string, unknown>>
  }>((root) => {
    root.routes.entry.then = {
      namespace: "ui",
      function: "missing",
      args: {
        extra: "$outputs.0",
      },
    }
  })

  assert.deepEqual(issueLocations(issues), [
    ["CAM_ROUTE_HANDOFF_MISMATCH", "routes.entry.then.function"],
  ])
})

test("read route continuation args must match UI node requirements exactly", () => {
  const issues = validateEditedRoot<{
    readonly routes: Record<string, Record<string, unknown>>
  }>((root) => {
    root.routes.entry.then = {
      namespace: "ui",
      function: "app",
      args: {
        extra: "$outputs.0",
      },
    }
  })

  assert.deepEqual(issueLocations(issues), [
    ["CAM_ROUTE_HANDOFF_MISMATCH", "routes.entry.then.args.extra"],
    ["CAM_ROUTE_HANDOFF_MISMATCH", "routes.entry.then.args.view"],
  ])
})

test("write route continuations must target declared routes with exact inputs", () => {
  const abiBytes = jsonBytes([
    {
      type: "function",
      name: "viewEntry",
      stateMutability: "view",
      inputs: [],
      outputs: [viewOutput()],
    },
    {
      type: "function",
      name: "save",
      stateMutability: "nonpayable",
      inputs: [
        {
          name: "serialNumber",
          type: "string",
        },
      ],
      outputs: [],
    },
  ])
  const issues = validateEditedRoot<{
    readonly namespaces: Record<string, Record<string, unknown>>
    readonly routes: Record<string, Record<string, unknown>>
  }>((root, bundle) => {
    root.routes.entry = {
      kind: "read",
      inputs: ["serialNumber"],
      call: {
        namespace: "contracts.App",
        function: "viewEntry",
        args: {},
      },
      then: {
        namespace: "ui",
        function: "app",
        args: {
          view: "$outputs.0",
        },
      },
    }
    root.routes.save = {
      kind: "write",
      inputs: ["serialNumber"],
      call: {
        namespace: "contracts.App",
        function: "save",
        args: {
          serialNumber: "$inputs.serialNumber",
        },
      },
      then: {
        namespace: "routes",
        function: "entry",
        args: {
          extra: "$inputs.serialNumber",
        },
      },
    }
    return replaceBundleResources(root, bundle, { abiBytes })
  })

  assert.deepEqual(issueLocations(issues), [
    ["CAM_ROUTE_HANDOFF_MISMATCH", "routes.save.then.args.extra"],
    ["CAM_ROUTE_HANDOFF_MISMATCH", "routes.save.then.args.serialNumber"],
  ])
})

test("UI node interfaces must use supported argument names", () => {
  const uiBytes = jsonBytes({
    ui: "1.0.0",
    nodes: {
      app: {
        tag: "Text",
        requires: ["foo"],
        props: {
          text: "$view.title",
        },
      },
    },
  })
  const issues = validateEditedRoot<{
    readonly namespaces: Record<string, Record<string, unknown>>
  }>((root, bundle) => {
    return replaceBundleResources(root, bundle, { uiBytes })
  })

  assert.deepEqual(issueLocations(issues), [
    ["CAM_UI_NODE_INTERFACE_INVALID", "nodes.app.requires.0"],
    ["CAM_UI_FIELD_INVALID", "nodes.app.requires.0"],
  ])
})

test("UI expressions must use protocol-owned roots", () => {
  const uiBytes = jsonBytes({
    ui: "1.0.0",
    nodes: {
      app: {
        tag: "Fragment",
        requires: ["view"],
        children: [
          {
            tag: "Text",
            props: {
              text: "$$literal",
            },
          },
          {
            tag: "Action",
            props: {
              label: "Open",
            },
            call: {
              namespace: "routes",
              function: "component",
              args: {
                serialNumber: "$external.serialNumber",
              },
            },
          },
          {
            tag: "Include",
            call: {
              namespace: "ui",
              function: "app",
              args: {
                view: "$view..title",
              },
            },
          },
        ],
      },
    },
  })
  const issues = validateEditedRoot<{
    readonly namespaces: Record<string, Record<string, unknown>>
    readonly routes: Record<string, Record<string, unknown>>
  }>((root, bundle) => {
    root.routes.component = {
      kind: "read",
      inputs: ["serialNumber"],
      call: {
        namespace: "contracts.App",
        function: "viewEntry",
        args: {},
      },
      then: {
        namespace: "ui",
        function: "app",
        args: {
          view: "$outputs.0",
        },
      },
    }
    return replaceBundleResources(root, bundle, { uiBytes })
  })

  assert.deepEqual(issueLocations(issues), [
    ["CAM_UI_EXPRESSION_ROOT_INVALID", "nodes.app.children.1.call.args.serialNumber"],
    ["CAM_UI_EXPRESSION_ROOT_INVALID", "nodes.app.children.2.call.args.view"],
    ["CAM_UI_EXPRESSION_INVALID", "nodes.app.children.1.call.args.serialNumber"],
  ])
})

test("UI actions must pass exactly the target route inputs", () => {
  const uiBytes = jsonBytes({
    ui: "1.0.0",
    nodes: {
      app: {
        tag: "Fragment",
        requires: ["view"],
        children: [
          {
            tag: "Action",
            props: {
              label: "Open",
            },
            call: {
              namespace: "routes",
              function: "component",
              args: {
                extra: "x",
              },
            },
          },
        ],
      },
    },
  })
  const issues = validateEditedRoot<{
    readonly namespaces: Record<string, Record<string, unknown>>
    readonly routes: Record<string, Record<string, unknown>>
  }>((root, bundle) => {
    root.routes.component = {
      kind: "read",
      inputs: ["serialNumber"],
      call: {
        namespace: "contracts.App",
        function: "viewEntry",
        args: {},
      },
      then: {
        namespace: "ui",
        function: "app",
        args: {
          view: "$outputs.0",
        },
      },
    }
    return replaceBundleResources(root, bundle, { uiBytes })
  })

  assert.deepEqual(issueLocations(issues), [
    ["CAM_UI_DATAFLOW_MISMATCH", "nodes.app.children.0.call.args.extra"],
    ["CAM_UI_DATAFLOW_MISMATCH", "nodes.app.children.0.call.args.serialNumber"],
  ])
})

test("UI action escaped call targets are checked as literal route names", () => {
  const uiBytes = jsonBytes({
    ui: "1.0.0",
    nodes: {
      app: {
        tag: "Fragment",
        requires: ["view"],
        children: [
          {
            tag: "Action",
            props: {
              label: "Open",
            },
            call: {
              namespace: "routes",
              function: "$$missing",
              args: {},
            },
          },
        ],
      },
    },
  })
  const issues = validateEditedRoot<{
    readonly namespaces: Record<string, Record<string, unknown>>
  }>((root, bundle) => {
    return replaceBundleResources(root, bundle, { uiBytes })
  })

  assert.deepEqual(issueLocations(issues), [
    ["CAM_UI_DATAFLOW_MISMATCH", "nodes.app.children.0.call.function"],
  ])
})

test("UI action route targets must be single strings, not arrays", () => {
  const uiBytes = jsonBytes({
    ui: "1.0.0",
    nodes: {
      app: {
        tag: "Fragment",
        requires: ["view"],
        children: [
          {
            tag: "Action",
            props: {
              label: "Open",
            },
            call: {
              namespace: "routes",
              function: ["entry"],
              args: {},
            },
          },
        ],
      },
    },
  })
  const issues = validateEditedRoot<{
    readonly namespaces: Record<string, Record<string, unknown>>
  }>((root, bundle) => {
    return replaceBundleResources(root, bundle, { uiBytes })
  })

  assert.deepEqual(issueLocations(issues), [
    ["CAM_UI_DATAFLOW_MISMATCH", "nodes.app.children.0.call.function"],
    ["CAM_UI_FIELD_INVALID", "nodes.app.children.0.call.function"],
  ])
})

test("UI action state references must be backed by Input names", () => {
  const uiBytes = jsonBytes({
    ui: "1.0.0",
    nodes: {
      app: {
        tag: "Fragment",
        requires: ["view"],
        children: [
          {
            tag: "Input",
            props: {
              name: "serialNumber",
              label: "Serial number",
              value: "",
            },
          },
          {
            tag: "Action",
            props: {
              label: "Open",
            },
            call: {
              namespace: "routes",
              function: "component",
              args: {
                serialNumber: "$state.serial",
              },
            },
          },
        ],
      },
    },
  })
  const issues = validateEditedRoot<{
    readonly namespaces: Record<string, Record<string, unknown>>
    readonly routes: Record<string, Record<string, unknown>>
  }>((root, bundle) => {
    root.routes.component = {
      kind: "read",
      inputs: ["serialNumber"],
      call: {
        namespace: "contracts.App",
        function: "viewEntry",
        args: {},
      },
      then: {
        namespace: "ui",
        function: "app",
        args: {
          view: "$outputs.0",
        },
      },
    }
    return replaceBundleResources(root, bundle, { uiBytes })
  })

  assert.deepEqual(issueLocations(issues), [
    ["CAM_UI_DATAFLOW_MISMATCH", "nodes.app.children.1.call.args.serialNumber"],
  ])
})

test("UI literal Input names must be state expression identifiers", () => {
  const uiBytes = jsonBytes({
    ui: "1.0.0",
    nodes: {
      app: {
        tag: "Text",
        requires: ["view"],
        props: {
          text: "valid app node",
        },
      },
      empty: {
        tag: "Input",
        requires: [],
        props: {
          name: "",
          label: "Empty",
          value: "",
        },
      },
      invalid: {
        tag: "Input",
        requires: ["view"],
        props: {
          name: "serial-number",
          label: "Serial number",
          value: "",
        },
      },
    },
  })
  const issues = validateEditedRoot<{
    readonly namespaces: Record<string, Record<string, unknown>>
  }>((root, bundle) => {
    return replaceBundleResources(root, bundle, { uiBytes })
  })

  assert.deepEqual(issueLocations(issues), [
    ["CAM_UI_DATAFLOW_MISMATCH", "nodes.empty.props.name"],
    ["CAM_UI_DATAFLOW_MISMATCH", "nodes.invalid.props.name"],
  ])
})

test("UI action state references must be backed by route-local rendered inputs", () => {
  const uiBytes = jsonBytes({
    ui: "1.0.0",
    nodes: {
      app: {
        tag: "Fragment",
        requires: ["view"],
        children: [
          {
            tag: "Include",
            call: {
              namespace: "ui",
              function: "edit",
              args: {
                view: "$view",
              },
            },
          },
        ],
      },
      edit: {
        tag: "Action",
        requires: ["view"],
        props: {
          label: "Open",
        },
        call: {
          namespace: "routes",
          function: "component",
          args: {
            serialNumber: "$state.serialNumber",
          },
        },
      },
      details: {
        tag: "Input",
        requires: ["view"],
        props: {
          name: "serialNumber",
          label: "Serial number",
          value: "",
        },
      },
    },
  })
  const issues = validateEditedRoot<{
    readonly namespaces: Record<string, Record<string, unknown>>
    readonly routes: Record<string, Record<string, unknown>>
  }>((root, bundle) => {
    root.routes.component = {
      kind: "read",
      inputs: ["serialNumber"],
      call: {
        namespace: "contracts.App",
        function: "viewEntry",
        args: {},
      },
      then: {
        namespace: "ui",
        function: "app",
        args: {
          view: "$outputs.0",
        },
      },
    }
    return replaceBundleResources(root, bundle, { uiBytes })
  })

  assert.deepEqual(issueLocations(issues), [
    ["CAM_UI_DATAFLOW_MISMATCH", "nodes.edit.call.args.serialNumber"],
  ])
})

test("UI action state references may use inputs from the route root tree", () => {
  const uiBytes = jsonBytes({
    ui: "1.0.0",
    nodes: {
      app: {
        tag: "Fragment",
        requires: ["view"],
        children: [
          {
            tag: "Input",
            props: {
              name: "serialNumber",
              label: "Serial number",
              value: "",
            },
          },
          {
            tag: "Include",
            call: {
              namespace: "ui",
              function: "actions",
              args: {
                view: "$view",
              },
            },
          },
        ],
      },
      actions: {
        tag: "Action",
        requires: ["view"],
        props: {
          label: "Open",
        },
        call: {
          namespace: "routes",
          function: "component",
          args: {
            serialNumber: "$state.serialNumber",
          },
        },
      },
    },
  })
  const issues = validateEditedRoot<{
    readonly namespaces: Record<string, Record<string, unknown>>
    readonly routes: Record<string, Record<string, unknown>>
  }>((root, bundle) => {
    root.routes.component = {
      kind: "read",
      inputs: ["serialNumber"],
      call: {
        namespace: "contracts.App",
        function: "viewEntry",
        args: {},
      },
      then: {
        namespace: "ui",
        function: "app",
        args: {
          view: "$outputs.0",
        },
      },
    }
    return replaceBundleResources(root, bundle, { uiBytes })
  })

  assert.deepEqual(issues, [])
})

test("UI call arg names must not be empty", () => {
  const uiBytes = jsonBytes({
    ui: "1.0.0",
    nodes: {
      app: {
        tag: "Fragment",
        requires: ["view"],
        children: [
          {
            tag: "Action",
            props: {
              label: "Open",
            },
            call: {
              namespace: "routes",
              function: "entry",
              args: {
                "": "x",
              },
            },
          },
          {
            tag: "Include",
            call: {
              namespace: "ui",
              function: "detail",
              args: {
                "": "$view",
              },
            },
          },
        ],
      },
      detail: {
        tag: "Text",
        requires: ["view"],
        props: {
          text: "$view.title",
        },
      },
    },
  })
  const issues = validateEditedRoot<{
    readonly namespaces: Record<string, Record<string, unknown>>
  }>((root, bundle) => {
    return replaceBundleResources(root, bundle, { uiBytes })
  })

  assert.deepEqual(issueLocations(issues), [
    ["CAM_UI_DATAFLOW_MISMATCH", "nodes.app.children.0.call.args"],
    ["CAM_UI_DATAFLOW_MISMATCH", "nodes.app.children.1.call.args"],
    ["CAM_UI_FIELD_INVALID", "nodes.app.children.0.call.args"],
  ])
})

test("UI Includes with literal targets must pass exactly the target node args", () => {
  const uiBytes = jsonBytes({
    ui: "1.0.0",
    nodes: {
      app: {
        tag: "Fragment",
        requires: ["view"],
        children: [
          {
            tag: "Include",
            call: {
              namespace: "ui",
              function: "detail",
              args: {
                extra: "x",
              },
            },
          },
        ],
      },
      detail: {
        tag: "Text",
        requires: ["view"],
        props: {
          text: "$view.title",
        },
      },
    },
  })
  const issues = validateEditedRoot<{
    readonly namespaces: Record<string, Record<string, unknown>>
  }>((root, bundle) => {
    return replaceBundleResources(root, bundle, { uiBytes })
  })

  assert.deepEqual(issueLocations(issues), [
    ["CAM_UI_DATAFLOW_MISMATCH", "nodes.app.children.0.call.args.extra"],
    ["CAM_UI_DATAFLOW_MISMATCH", "nodes.app.children.0.call.args.view"],
  ])
})

test("UI Include escaped call targets are checked as literal node names", () => {
  const uiBytes = jsonBytes({
    ui: "1.0.0",
    nodes: {
      app: {
        tag: "Fragment",
        requires: ["view"],
        children: [
          {
            tag: "Include",
            call: {
              namespace: "ui",
              function: "$$missing",
              args: {},
            },
          },
        ],
      },
    },
  })
  const issues = validateEditedRoot<{
    readonly namespaces: Record<string, Record<string, unknown>>
  }>((root, bundle) => {
    return replaceBundleResources(root, bundle, { uiBytes })
  })

  assert.deepEqual(issueLocations(issues), [
    ["CAM_UI_DATAFLOW_MISMATCH", "nodes.app.children.0.call.function"],
  ])
})

test("UI static call targets must not be empty or duplicated", () => {
  const uiBytes = jsonBytes({
    ui: "1.0.0",
    nodes: {
      app: {
        tag: "Fragment",
        requires: ["view"],
        children: [
          {
            tag: "Include",
            call: {
              namespace: "ui",
              function: ["detail", "detail"],
              args: {
                view: "$view",
              },
            },
          },
          {
            tag: "Include",
            call: {
              namespace: "ui",
              function: "",
              args: {},
            },
          },
        ],
      },
      detail: {
        tag: "Text",
        requires: ["view"],
        props: {
          text: "$view.title",
        },
      },
    },
  })
  const issues = validateEditedRoot<{
    readonly namespaces: Record<string, Record<string, unknown>>
  }>((root, bundle) => {
    return replaceBundleResources(root, bundle, { uiBytes })
  })

  assert.deepEqual(issueLocations(issues), [
    ["CAM_UI_DATAFLOW_MISMATCH", "nodes.app.children.0.call.function"],
    ["CAM_UI_DATAFLOW_MISMATCH", "nodes.app.children.1.call.function"],
  ])
})

test("UI Includes must not shadow runtime roots even when the target is dynamic", () => {
  const uiBytes = jsonBytes({
    ui: "1.0.0",
    nodes: {
      app: {
        tag: "Fragment",
        requires: ["view"],
        children: [
          {
            tag: "Include",
            call: {
              namespace: "ui",
              function: "$view.title",
              args: {
                state: {},
              },
            },
          },
        ],
      },
    },
  })
  const issues = validateEditedRoot<{
    readonly namespaces: Record<string, Record<string, unknown>>
  }>((root, bundle) => {
    return replaceBundleResources(root, bundle, { uiBytes })
  })

  assert.deepEqual(issueLocations(issues), [
    ["CAM_UI_DATAFLOW_MISMATCH", "nodes.app.children.0.call.args.state"],
  ])
})

test("UI props reject statically incompatible ABI-backed route outputs", () => {
  const abiBytes = jsonBytes([
    {
      type: "function",
      name: "viewEntry",
      stateMutability: "view",
      inputs: [],
      outputs: [
        {
          name: "view",
          type: "tuple",
          components: [
            {
              name: "owner",
              type: "uint256",
            },
          ],
        },
      ],
    },
  ])
  const uiBytes = jsonBytes({
    ui: "1.0.0",
    nodes: {
      app: {
        tag: "Fragment",
        requires: ["view"],
        children: [
          {
            tag: "Address",
            props: {
              label: "Owner",
              address: "$view.owner",
            },
          },
          {
            tag: "Text",
            props: {
              text: "$view.missingTitle",
            },
          },
        ],
      },
    },
  })
  const issues = validateEditedRoot<{
    readonly namespaces: Record<string, Record<string, unknown>>
  }>((root, bundle) => {
    return replaceBundleResources(root, bundle, { abiBytes, uiBytes })
  })

  assert.deepEqual(issueLocations(issues), [
    ["CAM_UI_TYPEFLOW_MISMATCH", "nodes.app.children.0.props.address"],
    ["CAM_UI_TYPEFLOW_MISMATCH", "nodes.app.children.1.props.text"],
  ])
})

test("UI props reject statically incompatible literal route handoff args", () => {
  const uiBytes = jsonBytes({
    ui: "1.0.0",
    nodes: {
      app: {
        tag: "Address",
        requires: ["view"],
        props: {
          label: "Owner",
          address: "$view.owner",
        },
      },
    },
  })
  const issues = validateEditedRoot<{
    readonly namespaces: Record<string, Record<string, unknown>>
    readonly routes: Record<string, Record<string, unknown>>
  }>((root, bundle) => {
    root.routes.entry = {
      ...root.routes.entry,
      then: {
        namespace: "ui",
        function: "app",
        args: {
          view: {
            owner: 123,
          },
        },
      },
    }
    return replaceBundleResources(root, bundle, { uiBytes })
  })

  assert.deepEqual(issueLocations(issues), [
    ["CAM_UI_TYPEFLOW_MISMATCH", "nodes.app.props.address"],
  ])
})

test("UI props reject statically incompatible literal Include args", () => {
  const uiBytes = jsonBytes({
    ui: "1.0.0",
    nodes: {
      app: {
        tag: "Fragment",
        requires: ["view"],
        children: [
          {
            tag: "Include",
            call: {
              namespace: "ui",
              function: "ownerPanel",
              args: {
                view: {
                  owner: 123,
                },
              },
            },
          },
        ],
      },
      ownerPanel: {
        tag: "Address",
        requires: ["view"],
        props: {
          label: "Owner",
          address: "$view.owner",
        },
      },
    },
  })
  const issues = validateEditedRoot<{
    readonly namespaces: Record<string, Record<string, unknown>>
  }>((root, bundle) => {
    return replaceBundleResources(root, bundle, { uiBytes })
  })

  assert.deepEqual(issueLocations(issues), [
    ["CAM_UI_TYPEFLOW_MISMATCH", "nodes.app.children.0.ownerPanel.props.address"],
  ])
})

test("UI props are checked against each route-local continuation shape", () => {
  const abiBytes = jsonBytes([
    {
      type: "function",
      name: "viewEntry",
      stateMutability: "view",
      inputs: [],
      outputs: [
        {
          name: "view",
          type: "tuple",
          components: [
            {
              name: "owner",
              type: "address",
            },
          ],
        },
      ],
    },
    {
      type: "function",
      name: "viewDetails",
      stateMutability: "view",
      inputs: [],
      outputs: [
        {
          name: "view",
          type: "tuple",
          components: [
            {
              name: "title",
              type: "string",
            },
          ],
        },
      ],
    },
  ])
  const uiBytes = jsonBytes({
    ui: "1.0.0",
    nodes: {
      app: {
        tag: "Address",
        requires: ["view"],
        props: {
          label: "Owner",
          address: "$view.owner",
        },
      },
    },
  })
  const issues = validateEditedRoot<{
    readonly namespaces: Record<string, Record<string, unknown>>
    readonly routes: Record<string, Record<string, unknown>>
  }>((root, bundle) => {
    root.routes.details = {
      kind: "read",
      inputs: [],
      call: {
        namespace: "contracts.App",
        function: "viewDetails",
        args: {},
      },
      then: {
        namespace: "ui",
        function: "app",
        args: {
          view: "$outputs.0",
        },
      },
    }
    return replaceBundleResources(root, bundle, { abiBytes, uiBytes })
  })

  assert.deepEqual(issueLocations(issues), [
    ["CAM_UI_TYPEFLOW_MISMATCH", "nodes.app.props.address"],
  ])
})

test("UI dynamic call targets reject statically incompatible ABI-backed route outputs", () => {
  const abiBytes = jsonBytes([
    {
      type: "function",
      name: "viewEntry",
      stateMutability: "view",
      inputs: [],
      outputs: [
        {
          name: "view",
          type: "tuple",
          components: [
            {
              name: "viewId",
              type: "uint256",
            },
            {
              name: "actions",
              type: "string[]",
            },
          ],
        },
      ],
    },
  ])
  const uiBytes = jsonBytes({
    ui: "1.0.0",
    nodes: {
      app: {
        tag: "Fragment",
        requires: ["view"],
        children: [
          {
            tag: "Include",
            call: {
              namespace: "ui",
              function: "$view.viewId",
              args: {
                view: "$view",
              },
            },
          },
          {
            tag: "Action",
            props: {
              label: "Do it",
            },
            call: {
              namespace: "routes",
              function: "$view.actions",
              args: {},
            },
          },
        ],
      },
    },
  })
  const issues = validateEditedRoot<{
    readonly namespaces: Record<string, Record<string, unknown>>
  }>((root, bundle) => {
    return replaceBundleResources(root, bundle, { abiBytes, uiBytes })
  })

  assert.deepEqual(issueLocations(issues), [
    ["CAM_UI_TYPEFLOW_MISMATCH", "nodes.app.children.0.call.function"],
    ["CAM_UI_TYPEFLOW_MISMATCH", "nodes.app.children.1.call.function"],
  ])
})

test("malformed resource declarations report each bad field", () => {
  const issues = validateEditedRoot<{
    readonly namespaces: Record<string, unknown>
  }>((root, bundle) => {
    root.namespaces["contracts.App"] = {
      type: "contract",
      abiURI: "",
    }
    return {
      resources: new Map([
        ["./ui.json", mustGetResource(bundle, "./ui.json")],
      ]),
    }
  })

  assert.deepEqual(issueLocations(issues), [
    ["CAM_RESOURCE_DECLARATION_INVALID", "namespaces.contracts.App.abiURI"],
    ["CAM_RESOURCE_DECLARATION_INVALID", "namespaces.contracts.App.integrity"],
    ["CAM_RUNTIME_CAM_INVALID", "namespaces.contracts.App.abiURI"],
  ])
})

test("resource declarations reject mutable remote and escaping URIs", () => {
  const issues = validateEditedRoot<{
    readonly namespaces: Record<string, Record<string, unknown>>
  }>((root) => {
    root.namespaces["contracts.App"].abiURI = "https://example.test/App.json"
    root.namespaces["contracts.Other"] = {
      type: "contract",
      abiURI: "./",
      integrity: "sha256:0x0000000000000000000000000000000000000000000000000000000000000000",
    }
    root.namespaces["contracts.Ipfs"] = {
      type: "contract",
      abiURI: "ipfs://../App.json",
      integrity: "sha256:0x0000000000000000000000000000000000000000000000000000000000000000",
    }
    root.namespaces["contracts.Encoded"] = {
      type: "contract",
      abiURI: "./%2e%2e/App.json",
      integrity: "sha256:0x0000000000000000000000000000000000000000000000000000000000000000",
    }
    root.namespaces.ui.uri = "../ui.json"
    return {
      resources: new Map(),
    }
  })

  assert.deepEqual(issueLocations(issues), [
    ["CAM_RESOURCE_DECLARATION_INVALID", "namespaces.contracts.App.abiURI"],
    ["CAM_RESOURCE_DECLARATION_INVALID", "namespaces.ui.uri"],
    ["CAM_RESOURCE_DECLARATION_INVALID", "namespaces.contracts.Other.abiURI"],
    ["CAM_RESOURCE_DECLARATION_INVALID", "namespaces.contracts.Ipfs.abiURI"],
    ["CAM_RESOURCE_DECLARATION_INVALID", "namespaces.contracts.Encoded.abiURI"],
    ["CAM_RUNTIME_CAM_INVALID", "namespaces.contracts.App.abiURI"],
  ])
})

test("undeclared bundle resources are reported as orphans", () => {
  const bundle = minimalBundle()
  const resources = new Map(bundle.resources)
  resources.set("./unused.json", jsonBytes({ unused: true }))

  const issues = validateCamBundle({
    ...bundle,
    resources,
  })

  assert.deepEqual(issues, [
    {
      rule: "CAM_RESOURCE_ORPHAN",
      severity: "error",
      resource: "./unused.json",
      message: "bundle resource is not declared by the root CAM document: ./unused.json",
    },
  ])
})

test("declared resources must not exceed the runtime resource size cap", () => {
  const oversizedAbiBytes = new Uint8Array(CAM_RESOURCE_MAX_BYTES + 1)
  const issues = validateEditedRoot<{
    readonly namespaces: Record<string, Record<string, unknown>>
  }>((root, bundle) => {
    return replaceBundleResources(root, bundle, { abiBytes: oversizedAbiBytes })
  })

  assert.deepEqual(issues, [
    {
      rule: "CAM_RESOURCE_TOO_LARGE",
      severity: "error",
      resource: "./abi/App.json",
      path: "namespaces.contracts.App.abiURI",
      message: `CAM resource is too large: ./abi/App.json has ${oversizedAbiBytes.byteLength} bytes; limit is ${CAM_RESOURCE_MAX_BYTES}`,
    },
  ])
})

test("conflicting integrity declarations for one URI are reported directly", () => {
  const issues = validateEditedRoot<{
    readonly namespaces: Record<string, unknown>
  }>((root) => {
    root.namespaces["contracts.Other"] = {
      type: "contract",
      abiURI: "./abi/App.json",
      integrity: "sha256:0x0000000000000000000000000000000000000000000000000000000000000000",
    }
  })

  assert.equal(issues[0]?.rule, "CAM_RESOURCE_INTEGRITY_CONFLICT")
  assert.equal(issues[0]?.resource, "./abi/App.json")
  assert.equal(issues[0]?.path, "namespaces.contracts.Other.integrity")
})

test("missing UI namespace is reported without hiding runtime incompatibility", () => {
  const issues = validateEditedRoot<{
    readonly namespaces: Record<string, unknown>
  }>((root, bundle) => {
    delete root.namespaces.ui
    return {
      resources: new Map([
        ["./abi/App.json", mustGetResource(bundle, "./abi/App.json")],
      ]),
    }
  })

  assert.deepEqual(issueRules(issues), [
    "CAM_UI_RESOURCE_MISSING",
    "CAM_ROUTE_INVOCATION_INVALID",
    "CAM_RUNTIME_CAM_INVALID",
  ])
})

test("invalid namespace declarations are reported together", () => {
  const issues = validateEditedRoot<{
    readonly namespaces: Record<string, unknown>
  }>((root) => {
    const appNamespace = root.namespaces["contracts.App"] as Record<string, unknown>
    const uiNamespace = root.namespaces.ui as Record<string, unknown>
    root.namespaces[""] = {
      type: "routes",
    }
    root.namespaces.flows = {
      type: "routes",
    }
    root.namespaces.screens = {
      type: "ui",
      uri: uiNamespace.uri,
      integrity: uiNamespace.integrity,
    }
    root.namespaces["contracts."] = {
      type: "contract",
      abiURI: appNamespace.abiURI,
      integrity: appNamespace.integrity,
    }
    root.namespaces.widgets = {
      type: "widget",
    }
  })

  assert.deepEqual(issueLocations(issues), [
    ["CAM_NAMESPACE_DECLARATION_INVALID", "namespaces"],
    ["CAM_NAMESPACE_DECLARATION_INVALID", "namespaces.flows"],
    ["CAM_NAMESPACE_DECLARATION_INVALID", "namespaces.screens"],
    ["CAM_NAMESPACE_DECLARATION_INVALID", "namespaces.contracts."],
    ["CAM_NAMESPACE_DECLARATION_INVALID", "namespaces.widgets.type"],
    ["CAM_RUNTIME_CAM_INVALID", "namespaces"],
  ])
})

test("invalid namespace names do not declare bundle resources", () => {
  const invalidAbiBytes = jsonBytes([])
  const issues = validateEditedRoot<{
    readonly namespaces: Record<string, unknown>
  }>((root, bundle) => {
    root.namespaces.Manager = {
      type: "contract",
      abiURI: "./abi/Manager.json",
      integrity: sha256Integrity(invalidAbiBytes),
    }
    return {
      resources: new Map([
        ...bundle.resources,
        ["./abi/Manager.json", invalidAbiBytes],
      ]),
    }
  })

  assert.deepEqual(issueLocations(issues), [
    ["CAM_NAMESPACE_DECLARATION_INVALID", "namespaces.Manager"],
    ["CAM_RESOURCE_ORPHAN", undefined],
    ["CAM_RUNTIME_CAM_INVALID", "namespaces.Manager"],
  ])
})

test("UI resource integrity mismatch returns one precise issue", () => {
  const issues = validateCamBundle(minimalBundle({
    uiIntegrity: "sha256:0x0000000000000000000000000000000000000000000000000000000000000000",
  }))

  assert.equal(issues.length, 1)
  assert.equal(issues[0]?.rule, "CAM_RESOURCE_INTEGRITY_MISMATCH")
  assert.equal(issues[0]?.severity, "error")
  assert.equal(issues[0]?.resource, "./ui.json")
  assert.equal(issues[0]?.path, "namespaces.ui.integrity")
  const issue = issues[0]
  assert.notEqual(issue, undefined)
  assert.match(issue.message, /CAM resource integrity mismatch/)
})
