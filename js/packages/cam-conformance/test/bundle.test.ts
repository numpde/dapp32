import assert from "node:assert/strict"
import test from "node:test"
import {
  CAM_VERSION,
  CAM_RESOURCE_MAX_BYTES,
  UI_VERSION,
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
  minimalBundleWithUiIntegrity,
  mustGetResource,
  overloadedViewEntryAbiBytes,
  replaceBundleResources,
  sha256Integrity,
  validateEditedRoot,
  viewEntryFunction,
  viewOutput,
  ZERO_SHA256_INTEGRITY,
} from "./fixtures.ts"
import type {
  RootWithNamespaces,
  RootWithNamespacesAndRoutes,
  RootWithRoutes,
} from "./fixtures.ts"

const encoder = new TextEncoder()

function viewTextNode() {
  return {
    element: "Text",
    requires: ["view"],
    props: {
      text: "$view.title",
    },
  }
}

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

test("malformed declared UI document inventory is reported directly", () => {
  const uiBytes = jsonBytes({
    ui: UI_VERSION,
    nodes: null,
  })
  const issues = validateEditedRoot<RootWithNamespaces>((root, bundle) => {
    return replaceBundleResources(root, bundle, { uiBytes })
  })

  assert.deepEqual(issueLocations(issues), [
    ["CAM_UI_DOCUMENT_INVALID", "nodes"],
  ])
})

test("empty UI node inventory is reported as a document issue", () => {
  const uiBytes = jsonBytes({
    ui: UI_VERSION,
    nodes: {},
  })
  const issues = validateEditedRoot<RootWithNamespaces>((root, bundle) => {
    return replaceBundleResources(root, bundle, { uiBytes })
  })

  assert.deepEqual(issueLocations(issues), [
    ["CAM_UI_DOCUMENT_INVALID", "nodes"],
  ])
})

test("UI document version and top-level fields are conformance-owned publication rules", () => {
  const versionIssues = validateEditedRoot<RootWithNamespaces>((root, bundle) => {
    return replaceBundleResources(root, bundle, {
      uiBytes: jsonBytes({
        ui: "2.0.0",
        nodes: {
          app: viewTextNode(),
        },
      }),
    })
  })
  assert.deepEqual(issueLocations(versionIssues), [
    ["CAM_UI_DOCUMENT_INVALID", "ui"],
  ])

  const fieldIssues = validateEditedRoot<RootWithNamespaces>((root, bundle) => {
    return replaceBundleResources(root, bundle, {
      uiBytes: jsonBytes({
        ui: UI_VERSION,
        title: "metadata-like fields do not belong in UI resources",
        nodes: {
          app: viewTextNode(),
        },
      }),
    })
  })
  assert.deepEqual(issueLocations(fieldIssues), [
    ["CAM_UI_DOCUMENT_INVALID", "title"],
  ])
})

test("empty UI node names are reported as node inventory issues", () => {
  const uiBytes = jsonBytes({
    ui: UI_VERSION,
    nodes: {
      "": {
        element: "Text",
        requires: ["view"],
        props: {
          text: "$view.title",
        },
      },
    },
  })
  const issues = validateEditedRoot<RootWithNamespaces>((root, bundle) => {
    return replaceBundleResources(root, bundle, { uiBytes })
  })

  assert.deepEqual(issueLocations(issues), [
    ["CAM_UI_NODE_INTERFACE_INVALID", "nodes"],
    ["CAM_ROUTE_HANDOFF_MISMATCH", "routes.entry.then.function"],
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

test("non-object root CAM JSON is reported directly", () => {
  const issues = validateCamBundle({
    ...minimalBundle(),
    rootBytes: jsonBytes([]),
  })

  assert.deepEqual(issueLocations(issues), [
    ["CAM_MANIFEST_ROOT_INVALID", undefined],
  ])
})

test("root CAM bytes must not exceed the protocol resource size cap", () => {
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

test("root-level checks report alongside resource checks", () => {
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
  ])
})

test("malformed entry route is reported directly", () => {
  const issues = validateEditedRoot((root) => {
    root.entry = ""
  })

  assert.deepEqual(issueLocations(issues), [
    ["CAM_ENTRY_ROUTE_INVALID", "entry"],
  ])
})

test("missing entry route is reported as a precise manifest issue", () => {
  const issues = validateEditedRoot((root) => {
    root.entry = "missing"
  })

  assert.deepEqual(issueLocations(issues), [
    ["CAM_ENTRY_ROUTE_MISSING", "entry"],
  ])
})

test("malformed route inventory is reported directly", () => {
  const issues = validateEditedRoot((root) => {
    root.routes = null
  })

  assert.deepEqual(issueLocations(issues), [
    ["CAM_ROUTE_DECLARATION_INVALID", "routes"],
  ])
})

test("malformed route declarations are reported directly", () => {
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

test("CAM manifest version is a conformance-owned publication rule", () => {
  const issues = validateEditedRoot<Record<string, unknown>>((root) => {
    root.cam = "2.0.0"
    root.entry = ""
    root.unexpected = true
  })

  assert.deepEqual(issueLocations(issues), [
    ["CAM_MANIFEST_VERSION_INVALID", "cam"],
  ])

  const missing = validateEditedRoot<Record<string, unknown>>((root) => {
    delete root.cam
  })
  assert.deepEqual(issueLocations(missing), [
    ["CAM_MANIFEST_VERSION_INVALID", "cam"],
  ])

  const valid = validateEditedRoot<Record<string, unknown>>((root) => {
    root.cam = CAM_VERSION
  })
  assert.equal(valid.some((issue) => issue.rule === "CAM_MANIFEST_VERSION_INVALID"), false)
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
  ])
})

test("route expressions must reference declared route inputs", () => {
  const issues = validateEditedRoot<RootWithRoutes>((root) => {
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

test("route input expressions must use declared input names, not numeric segments", () => {
  const issues = validateEditedRoot<RootWithRoutes>((root) => {
    root.routes.entry = {
      kind: "read",
      inputs: ["serialNumber"],
      call: {
        namespace: "contracts.App",
        function: "viewEntry",
        args: {
          serialNumber: "$inputs.0",
        },
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
    ["CAM_ROUTE_EXPRESSION_INVALID", "routes.entry.call.args.serialNumber"],
    ["CAM_ROUTE_ABI_MISMATCH", "routes.entry.call.args.serialNumber"],
  ])
})

test("route call expressions cannot reference outputs before the call runs", () => {
  const issues = validateEditedRoot<RootWithRoutes>((root) => {
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
  const issues = validateEditedRoot<RootWithNamespacesAndRoutes>((root, bundle) => {
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
  ])
})

test("write route continuations cannot reference transaction outputs", () => {
  const abiBytes = jsonBytes([
    viewEntryFunction(),
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
  const issues = validateEditedRoot<RootWithNamespacesAndRoutes>((root, bundle) => {
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
  ])
})

test("route invocation arg names must not be empty", () => {
  const issues = validateEditedRoot<RootWithRoutes>((root) => {
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
  ])
})

test("route calls must target functions declared by the namespace ABI", () => {
  const issues = validateEditedRoot<RootWithRoutes>((root) => {
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
  const issues = validateEditedRoot<RootWithNamespaces>((root, bundle) => {
    return replaceBundleResources(root, bundle, { abiBytes })
  })

  assert.deepEqual(issueLocations(issues), [
    ["CAM_ROUTE_ABI_MISMATCH", "routes.entry.call.function"],
  ])
})

test("full route function signatures disambiguate overloads", () => {
  const abiBytes = overloadedViewEntryAbiBytes()
  const issues = validateEditedRoot<RootWithNamespacesAndRoutes>((root, bundle) => {
    const entry = root.routes.entry
    const call = entry.call as Record<string, unknown>
    call.function = "viewEntry()"
    return replaceBundleResources(root, bundle, { abiBytes })
  })

  assert.deepEqual(issues, [])
})

test("route function references must be names or full signatures", () => {
  const issues = validateEditedRoot<RootWithRoutes>((root) => {
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

test("ABI resource validation rejects invalid published function shapes", () => {
  assert.deepEqual(abiIssueLocationsFor(encoder.encode("{")), [
    ["CAM_ABI_INVALID", undefined],
  ])

  assert.deepEqual(abiIssueLocationsFor(jsonBytes({ abi: [] })), [
    ["CAM_ABI_INVALID", undefined],
  ])

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
  const issues = validateEditedRoot<RootWithNamespacesAndRoutes>((root, bundle) => {
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
  const issues = validateEditedRoot<RootWithNamespacesAndRoutes>((root, bundle) => {
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

test("route call literal strings must match exact ABI scalar syntax when statically known", () => {
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
        {
          name: "payload",
          type: "bytes",
        },
        {
          name: "salt",
          type: "bytes4",
        },
      ],
      outputs: [viewOutput()],
    },
  ])
  const issues = validateEditedRoot<RootWithNamespacesAndRoutes>((root, bundle) => {
    root.routes.entry.call = {
      namespace: "contracts.App",
      function: "viewEntry",
      args: {
        active: "true",
        count: "1",
        owner: "0x0000000000000000000000000000000000000aAa",
        payload: "0x1234",
        salt: "0x12345678",
      },
    }
    return replaceBundleResources(root, bundle, { abiBytes })
  })

  assert.deepEqual(issueLocations(issues), [
    ["CAM_ROUTE_ABI_MISMATCH", "routes.entry.call.args.active"],
  ])
})

test("route call invalid literal strings are rejected at publication time", () => {
  const abiBytes = jsonBytes([
    {
      type: "function",
      name: "viewEntry",
      stateMutability: "view",
      inputs: [
        {
          name: "count",
          type: "uint8",
        },
        {
          name: "owner",
          type: "address",
        },
        {
          name: "payload",
          type: "bytes",
        },
        {
          name: "salt",
          type: "bytes4",
        },
      ],
      outputs: [viewOutput()],
    },
  ])
  const issues = validateEditedRoot<RootWithNamespacesAndRoutes>((root, bundle) => {
    root.routes.entry.call = {
      namespace: "contracts.App",
      function: "viewEntry",
      args: {
        count: "256",
        owner: "not-an-address",
        payload: "0x123",
        salt: "0x1234",
      },
    }
    return replaceBundleResources(root, bundle, { abiBytes })
  })

  assert.deepEqual(issueLocations(issues), [
    ["CAM_ROUTE_ABI_MISMATCH", "routes.entry.call.args.count"],
    ["CAM_ROUTE_ABI_MISMATCH", "routes.entry.call.args.owner"],
    ["CAM_ROUTE_ABI_MISMATCH", "routes.entry.call.args.payload"],
    ["CAM_ROUTE_ABI_MISMATCH", "routes.entry.call.args.salt"],
  ])
})

test("route call numeric integer literals must fit ABI range exactly", () => {
  const abiBytes = jsonBytes([
    {
      type: "function",
      name: "viewEntry",
      stateMutability: "view",
      inputs: [
        {
          name: "small",
          type: "uint8",
        },
        {
          name: "precise",
          type: "uint256",
        },
      ],
      outputs: [viewOutput()],
    },
  ])
  const issues = validateEditedRoot<RootWithNamespacesAndRoutes>((root, bundle) => {
    root.routes.entry.call = {
      namespace: "contracts.App",
      function: "viewEntry",
      args: {
        small: 256,
        precise: Number.MAX_SAFE_INTEGER + 1,
      },
    }
    return replaceBundleResources(root, bundle, { abiBytes })
  })

  assert.deepEqual(issueLocations(issues), [
    ["CAM_ROUTE_ABI_MISMATCH", "routes.entry.call.args.small"],
    ["CAM_ROUTE_ABI_MISMATCH", "routes.entry.call.args.precise"],
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
  const issues = validateEditedRoot<RootWithNamespacesAndRoutes>((root, bundle) => {
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

test("route call literal tuple and array args are checked recursively", () => {
  const abiBytes = jsonBytes([
    {
      type: "function",
      name: "viewEntry",
      stateMutability: "view",
      inputs: [
        {
          name: "payload",
          type: "tuple",
          components: [
            {
              name: "serialNumber",
              type: "string",
            },
            {
              name: "counts",
              type: "uint256[]",
            },
            {
              name: "owner",
              type: "address",
            },
          ],
        },
      ],
      outputs: [viewOutput()],
    },
  ])
  const issues = validateEditedRoot<RootWithNamespacesAndRoutes>((root, bundle) => {
    root.routes.entry.call = {
      namespace: "contracts.App",
      function: "viewEntry",
      args: {
        payload: {
          serialNumber: 123,
          counts: [1, false],
          extra: "x",
        },
      },
    }
    return replaceBundleResources(root, bundle, { abiBytes })
  })

  assert.deepEqual(issueLocations(issues), [
    ["CAM_ROUTE_ABI_MISMATCH", "routes.entry.call.args.payload.extra"],
    ["CAM_ROUTE_ABI_MISMATCH", "routes.entry.call.args.payload.owner"],
    ["CAM_ROUTE_ABI_MISMATCH", "routes.entry.call.args.payload.serialNumber"],
    ["CAM_ROUTE_ABI_MISMATCH", "routes.entry.call.args.payload.counts.1"],
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
  const issues = validateEditedRoot<RootWithNamespaces>((root, bundle) => {
    return replaceBundleResources(root, bundle, { abiBytes })
  })

  assert.deepEqual(issueLocations(issues), [
    ["CAM_ROUTE_ABI_MISMATCH", "routes.entry.then.args.view"],
  ])
})

test("route continuations must reference ABI-declared tuple fields", () => {
  const issues = validateEditedRoot<RootWithRoutes>((root) => {
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
  const issues = validateEditedRoot<RootWithRoutes>((root) => {
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
  const issues = validateEditedRoot<RootWithRoutes>((root) => {
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
    viewEntryFunction(),
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
  const issues = validateEditedRoot<RootWithNamespacesAndRoutes>((root, bundle) => {
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

test("write route continuation literal args are checked against the next route ABI call", () => {
  const abiBytes = jsonBytes([
    viewEntryFunction(),
    {
      type: "function",
      name: "saveAmount",
      stateMutability: "nonpayable",
      inputs: [],
      outputs: [],
    },
    {
      type: "function",
      name: "viewAmount",
      stateMutability: "view",
      inputs: [
        {
          name: "amount",
          type: "uint8",
        },
      ],
      outputs: [viewOutput()],
    },
  ])
  const issues = validateEditedRoot<RootWithNamespacesAndRoutes>((root, bundle) => {
    root.routes.saveAmount = {
      kind: "write",
      inputs: [],
      call: {
        namespace: "contracts.App",
        function: "saveAmount",
        args: {},
      },
      then: {
        namespace: "routes",
        function: "amount",
        args: {
          amount: 256,
        },
      },
    }
    root.routes.amount = {
      kind: "read",
      inputs: ["amount"],
      call: {
        namespace: "contracts.App",
        function: "viewAmount",
        args: {
          amount: "$inputs.amount",
        },
      },
      then: {
        namespace: "ui",
        function: "app",
        args: {
          view: "$outputs.0",
        },
      },
    }
    return replaceBundleResources(root, bundle, { abiBytes })
  })

  assert.deepEqual(issueLocations(issues), [
    ["CAM_ROUTE_HANDOFF_MISMATCH", "routes.saveAmount.then.args.amount"],
  ])
})

test("write route continuation partially known nested args still report ABI failures", () => {
  const abiBytes = jsonBytes([
    viewEntryFunction(),
    {
      type: "function",
      name: "savePayload",
      stateMutability: "nonpayable",
      inputs: [],
      outputs: [],
    },
    {
      type: "function",
      name: "viewPayload",
      stateMutability: "view",
      inputs: [
        {
          name: "payload",
          type: "tuple",
          components: [
            {
              name: "serial",
              type: "uint8",
            },
            {
              name: "note",
              type: "string",
            },
          ],
        },
      ],
      outputs: [viewOutput()],
    },
  ])
  const issues = validateEditedRoot<RootWithNamespacesAndRoutes>((root, bundle) => {
    root.routes.savePayload = {
      kind: "write",
      inputs: ["note"],
      call: {
        namespace: "contracts.App",
        function: "savePayload",
        args: {},
      },
      then: {
        namespace: "routes",
        function: "payload",
        args: {
          payload: {
            serial: 256,
            note: "$inputs.note",
          },
        },
      },
    }
    root.routes.payload = {
      kind: "read",
      inputs: ["payload"],
      call: {
        namespace: "contracts.App",
        function: "viewPayload",
        args: {
          payload: "$inputs.payload",
        },
      },
      then: {
        namespace: "ui",
        function: "app",
        args: {
          view: "$outputs.0",
        },
      },
    }
    return replaceBundleResources(root, bundle, { abiBytes })
  })

  assert.deepEqual(issueLocations(issues), [
    ["CAM_ROUTE_HANDOFF_MISMATCH", "routes.savePayload.then.args.payload.serial"],
  ])
})

test("write route continuation partially known array args still report ABI failures", () => {
  const abiBytes = jsonBytes([
    viewEntryFunction(),
    {
      type: "function",
      name: "saveValues",
      stateMutability: "nonpayable",
      inputs: [],
      outputs: [],
    },
    {
      type: "function",
      name: "viewValues",
      stateMutability: "view",
      inputs: [
        {
          name: "values",
          type: "uint8[]",
        },
      ],
      outputs: [viewOutput()],
    },
  ])
  const issues = validateEditedRoot<RootWithNamespacesAndRoutes>((root, bundle) => {
    root.routes.saveValues = {
      kind: "write",
      inputs: ["value"],
      call: {
        namespace: "contracts.App",
        function: "saveValues",
        args: {},
      },
      then: {
        namespace: "routes",
        function: "values",
        args: {
          values: [256, "$inputs.value"],
        },
      },
    }
    root.routes.values = {
      kind: "read",
      inputs: ["values"],
      call: {
        namespace: "contracts.App",
        function: "viewValues",
        args: {
          values: "$inputs.values",
        },
      },
      then: {
        namespace: "ui",
        function: "app",
        args: {
          view: "$outputs.0",
        },
      },
    }
    return replaceBundleResources(root, bundle, { abiBytes })
  })

  assert.deepEqual(issueLocations(issues), [
    ["CAM_ROUTE_HANDOFF_MISMATCH", "routes.saveValues.then.args.values.0"],
  ])
})

test("write route continuation ABI diagnostics distinguish route literals from handoff args", () => {
  const abiBytes = jsonBytes([
    viewEntryFunction(),
    {
      type: "function",
      name: "saveAmount",
      stateMutability: "nonpayable",
      inputs: [],
      outputs: [],
    },
    {
      type: "function",
      name: "viewAmount",
      stateMutability: "view",
      inputs: [
        {
          name: "amount",
          type: "uint8",
        },
      ],
      outputs: [viewOutput()],
    },
  ])
  const issues = validateEditedRoot<RootWithNamespacesAndRoutes>((root, bundle) => {
    root.routes.saveAmount = {
      kind: "write",
      inputs: [],
      call: {
        namespace: "contracts.App",
        function: "saveAmount",
        args: {},
      },
      then: {
        namespace: "routes",
        function: "amount",
        args: {},
      },
    }
    root.routes.amount = {
      kind: "read",
      inputs: [],
      call: {
        namespace: "contracts.App",
        function: "viewAmount",
        args: {
          amount: 256,
        },
      },
      then: {
        namespace: "ui",
        function: "app",
        args: {
          view: "$outputs.0",
        },
      },
    }
    return replaceBundleResources(root, bundle, { abiBytes })
  })

  assert.deepEqual(issueLocations(issues), [
    ["CAM_ROUTE_ABI_MISMATCH", "routes.amount.call.args.amount"],
  ])
})

test("UI node interfaces must use supported argument names", () => {
  const uiBytes = jsonBytes({
    ui: UI_VERSION,
    nodes: {
      app: {
        element: "Text",
        requires: ["foo"],
        props: {
          text: "$view.title",
        },
      },
    },
  })
  const issues = validateEditedRoot<RootWithNamespaces>((root, bundle) => {
    return replaceBundleResources(root, bundle, { uiBytes })
  })

  assert.deepEqual(issueLocations(issues), [
    ["CAM_UI_NODE_INTERFACE_INVALID", "nodes.app.requires.0"],
  ])
})

test("UI expressions must use protocol-owned roots", () => {
  const uiBytes = jsonBytes({
    ui: UI_VERSION,
    nodes: {
      app: {
        element: "Fragment",
        requires: ["view"],
        children: [
          {
            element: "Text",
            props: {
              text: "$$literal",
            },
          },
          {
            element: "Button",
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
            element: "Include",
            call: {
              namespace: "ui",
              function: "detail",
              args: {
                view: "$view..title",
              },
            },
          },
        ],
      },
      detail: {
        element: "Text",
        requires: ["view"],
        props: {
          text: "$view.title",
        },
      },
    },
  })
  const issues = validateEditedRoot<RootWithNamespacesAndRoutes>((root, bundle) => {
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
  ])
})

test("UI Buttons must pass exactly the target route inputs", () => {
  const uiBytes = jsonBytes({
    ui: UI_VERSION,
    nodes: {
      app: {
        element: "Fragment",
        requires: ["view"],
        children: [
          {
            element: "Button",
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
      done: viewTextNode(),
    },
  })
  const issues = validateEditedRoot<RootWithNamespacesAndRoutes>((root, bundle) => {
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
        function: "done",
        args: {
          view: "$outputs.0",
        },
      },
    }
    return replaceBundleResources(root, bundle, { uiBytes })
  })

  assert.deepEqual(issueLocations(issues), [
    ["CAM_UI_TYPEFLOW_MISMATCH", "nodes.app.children.0.call.args.extra"],
    ["CAM_UI_TYPEFLOW_MISMATCH", "nodes.app.children.0.call.args.serialNumber"],
  ])
})

test("UI Button route existence is checked for literal targets", () => {
  const uiBytes = jsonBytes({
    ui: UI_VERSION,
    nodes: {
      app: {
        element: "Button",
        requires: ["view"],
        props: {
          label: "Open",
        },
        call: {
          namespace: "routes",
          function: "missing",
          args: {},
        },
      },
    },
  })
  const issues = validateEditedRoot<RootWithNamespaces>((root, bundle) => {
    return replaceBundleResources(root, bundle, { uiBytes })
  })

  assert.deepEqual(issueLocations(issues), [
    ["CAM_UI_TYPEFLOW_MISMATCH", "nodes.app.call.function"],
  ])
})

test("UI Button literal args are ABI-checked through the target route", () => {
  const abiBytes = jsonBytes([
    viewEntryFunction(),
    {
      type: "function",
      name: "saveAmount",
      stateMutability: "nonpayable",
      inputs: [
        {
          name: "amount",
          type: "uint8",
        },
      ],
      outputs: [],
    },
  ])
  const uiBytes = jsonBytes({
    ui: UI_VERSION,
    nodes: {
      app: {
        element: "Fragment",
        requires: ["view"],
        children: [
          {
            element: "Button",
            props: {
              label: "Save",
            },
            call: {
              namespace: "routes",
              function: "saveAmount",
              args: {
                amount: 256,
              },
            },
          },
        ],
      },
    },
  })
  const issues = validateEditedRoot<RootWithNamespacesAndRoutes>((root, bundle) => {
    root.routes.saveAmount = {
      kind: "write",
      inputs: ["amount"],
      call: {
        namespace: "contracts.App",
        function: "saveAmount",
        args: {
          amount: "$inputs.amount",
        },
      },
      then: {
        namespace: "routes",
        function: "entry",
        args: {},
      },
    }
    return replaceBundleResources(root, bundle, { abiBytes, uiBytes })
  })

  assert.deepEqual(issueLocations(issues), [
    ["CAM_UI_TYPEFLOW_MISMATCH", "nodes.app.children.0.call.args.amount"],
  ])
})

test("UI Button literal args are ABI-checked through nested route call values", () => {
  const abiBytes = jsonBytes([
    viewEntryFunction(),
    {
      type: "function",
      name: "savePayload",
      stateMutability: "nonpayable",
      inputs: [
        {
          name: "payload",
          type: "tuple",
          components: [
            {
              name: "amount",
              type: "uint8",
            },
            {
              name: "note",
              type: "string",
            },
          ],
        },
      ],
      outputs: [],
    },
  ])
  const uiBytes = jsonBytes({
    ui: UI_VERSION,
    nodes: {
      app: {
        element: "Button",
        requires: ["view"],
        props: {
          label: "Save",
        },
        call: {
          namespace: "routes",
          function: "savePayload",
          args: {
            amount: 256,
            note: "note",
          },
        },
      },
    },
  })
  const issues = validateEditedRoot<RootWithNamespacesAndRoutes>((root, bundle) => {
    root.routes.savePayload = {
      kind: "write",
      inputs: ["amount", "note"],
      call: {
        namespace: "contracts.App",
        function: "savePayload",
        args: {
          payload: {
            amount: "$inputs.amount",
            note: "$inputs.note",
          },
        },
      },
      then: {
        namespace: "routes",
        function: "entry",
        args: {},
      },
    }
    return replaceBundleResources(root, bundle, { abiBytes, uiBytes })
  })

  assert.deepEqual(issueLocations(issues), [
    ["CAM_UI_TYPEFLOW_MISMATCH", "nodes.app.call.args.amount"],
  ])
})

test("UI Button ABI aggregate mismatches point at the action argument", () => {
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
      name: "savePayload",
      stateMutability: "nonpayable",
      inputs: [
        {
          name: "payload",
          type: "tuple",
          components: [
            {
              name: "amount",
              type: "uint8",
            },
          ],
        },
      ],
      outputs: [],
    },
  ])
  const uiBytes = jsonBytes({
    ui: UI_VERSION,
    nodes: {
      app: {
        element: "Button",
        requires: ["view"],
        props: {
          label: "Save",
        },
        call: {
          namespace: "routes",
          function: "savePayload",
          args: {
            payload: [],
          },
        },
      },
    },
  })
  const issues = validateEditedRoot<RootWithNamespacesAndRoutes>((root, bundle) => {
    root.routes.savePayload = {
      kind: "write",
      inputs: ["payload"],
      call: {
        namespace: "contracts.App",
        function: "savePayload",
        args: {
          payload: "$inputs.payload",
        },
      },
      then: {
        namespace: "routes",
        function: "entry",
        args: {},
      },
    }
    return replaceBundleResources(root, bundle, { abiBytes, uiBytes })
  })

  assert.deepEqual(issueLocations(issues), [
    ["CAM_UI_TYPEFLOW_MISMATCH", "nodes.app.call.args.payload"],
  ])
})

test("UI Button ABI checks preserve known fields in direct aggregate args", () => {
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
      name: "savePayload",
      stateMutability: "nonpayable",
      inputs: [
        {
          name: "payload",
          type: "tuple",
          components: [
            {
              name: "amount",
              type: "uint8",
            },
            {
              name: "note",
              type: "string",
            },
          ],
        },
      ],
      outputs: [],
    },
  ])
  const uiBytes = jsonBytes({
    ui: UI_VERSION,
    nodes: {
      app: {
        element: "Button",
        requires: ["view"],
        props: {
          label: "Save",
        },
        call: {
          namespace: "routes",
          function: "savePayload",
          args: {
            payload: {
              amount: 256,
              note: "note",
            },
          },
        },
      },
    },
  })
  const issues = validateEditedRoot<RootWithNamespacesAndRoutes>((root, bundle) => {
    root.routes.savePayload = {
      kind: "write",
      inputs: ["payload"],
      call: {
        namespace: "contracts.App",
        function: "savePayload",
        args: {
          payload: "$inputs.payload",
        },
      },
      then: {
        namespace: "routes",
        function: "entry",
        args: {},
      },
    }
    return replaceBundleResources(root, bundle, { abiBytes, uiBytes })
  })

  assert.deepEqual(issueLocations(issues), [
    ["CAM_UI_TYPEFLOW_MISMATCH", "nodes.app.call.args.payload.amount"],
  ])
})

test("UI Button ABI checks preserve known fields in direct array args", () => {
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
      name: "saveValues",
      stateMutability: "nonpayable",
      inputs: [
        {
          name: "values",
          type: "uint8[]",
        },
      ],
      outputs: [],
    },
  ])
  const uiBytes = jsonBytes({
    ui: UI_VERSION,
    nodes: {
      app: {
        element: "Button",
        requires: ["view"],
        props: {
          label: "Save",
        },
        call: {
          namespace: "routes",
          function: "saveValues",
          args: {
            values: [
              256,
              1,
            ],
          },
        },
      },
    },
  })
  const issues = validateEditedRoot<RootWithNamespacesAndRoutes>((root, bundle) => {
    root.routes.saveValues = {
      kind: "write",
      inputs: ["values"],
      call: {
        namespace: "contracts.App",
        function: "saveValues",
        args: {
          values: "$inputs.values",
        },
      },
      then: {
        namespace: "routes",
        function: "entry",
        args: {},
      },
    }
    return replaceBundleResources(root, bundle, { abiBytes, uiBytes })
  })

  assert.deepEqual(issueLocations(issues), [
    ["CAM_UI_TYPEFLOW_MISMATCH", "nodes.app.call.args.values.0"],
  ])
})

test("UI Button ABI checks escaped dollar literals as literal strings", () => {
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
      name: "saveAmount",
      stateMutability: "nonpayable",
      inputs: [
        {
          name: "amount",
          type: "uint8",
        },
      ],
      outputs: [],
    },
  ])
  const uiBytes = jsonBytes({
    ui: UI_VERSION,
    nodes: {
      app: {
        element: "Button",
        requires: ["view"],
        props: {
          label: "Save",
        },
        call: {
          namespace: "routes",
          function: "saveAmount",
          args: {
            amount: "$$unknown",
          },
        },
      },
    },
  })
  const issues = validateEditedRoot<RootWithNamespacesAndRoutes>((root, bundle) => {
    root.routes.saveAmount = {
      kind: "write",
      inputs: ["amount"],
      call: {
        namespace: "contracts.App",
        function: "saveAmount",
        args: {
          amount: "$inputs.amount",
        },
      },
      then: {
        namespace: "routes",
        function: "entry",
        args: {},
      },
    }
    return replaceBundleResources(root, bundle, { abiBytes, uiBytes })
  })

  assert.deepEqual(issueLocations(issues), [
    ["CAM_UI_TYPEFLOW_MISMATCH", "nodes.app.call.args.amount"],
  ])
})

test("UI Button ABI checks preserve literal values passed through Includes", () => {
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
      name: "savePayload",
      stateMutability: "nonpayable",
      inputs: [
        {
          name: "payload",
          type: "tuple",
          components: [
            {
              name: "amount",
              type: "uint8",
            },
            {
              name: "note",
              type: "string",
            },
          ],
        },
      ],
      outputs: [],
    },
  ])
  const uiBytes = jsonBytes({
    ui: UI_VERSION,
    nodes: {
      app: {
        element: "Include",
        requires: ["view"],
        call: {
          namespace: "ui",
          function: "writer",
          args: {
            view: {
              payload: {
                amount: 256,
                note: "note",
              },
            },
          },
        },
      },
      writer: {
        element: "Button",
        requires: ["view"],
        props: {
          label: "Save",
        },
        call: {
          namespace: "routes",
          function: "savePayload",
          args: {
            payload: "$view.payload",
          },
        },
      },
    },
  })
  const issues = validateEditedRoot<RootWithNamespacesAndRoutes>((root, bundle) => {
    root.routes.savePayload = {
      kind: "write",
      inputs: ["payload"],
      call: {
        namespace: "contracts.App",
        function: "savePayload",
        args: {
          payload: "$inputs.payload",
        },
      },
      then: {
        namespace: "routes",
        function: "entry",
        args: {},
      },
    }
    return replaceBundleResources(root, bundle, { abiBytes, uiBytes })
  })

  assert.deepEqual(issueLocations(issues), [
    ["CAM_UI_TYPEFLOW_MISMATCH", "nodes.app.writer.call.args.payload.amount"],
  ])
})

test("UI Button escaped call targets are checked as literal route names", () => {
  const uiBytes = jsonBytes({
    ui: UI_VERSION,
    nodes: {
      app: {
        element: "Fragment",
        requires: ["view"],
        children: [
          {
            element: "Button",
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
      done: viewTextNode(),
    },
  })
  const issues = validateEditedRoot<RootWithNamespaces>((root, bundle) => {
    return replaceBundleResources(root, bundle, { uiBytes })
  })

  assert.deepEqual(issueLocations(issues), [
    ["CAM_UI_TYPEFLOW_MISMATCH", "nodes.app.children.0.call.function"],
  ])
})

test("UI Button route targets must be single strings, not arrays", () => {
  const uiBytes = jsonBytes({
    ui: UI_VERSION,
    nodes: {
      app: {
        element: "Fragment",
        requires: ["view"],
        children: [
          {
            element: "Button",
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
      done: viewTextNode(),
    },
  })
  const issues = validateEditedRoot<RootWithNamespaces>((root, bundle) => {
    return replaceBundleResources(root, bundle, { uiBytes })
  })

  assert.deepEqual(issueLocations(issues), [
    ["CAM_UI_DATAFLOW_MISMATCH", "nodes.app.children.0.call.function"],
  ])
})

test("UI Button state references must be backed by TextField state keys", () => {
  const uiBytes = jsonBytes({
    ui: UI_VERSION,
    nodes: {
      app: {
        element: "Fragment",
        requires: ["view"],
        children: [
          {
            element: "TextField",
            props: {
              label: "Serial number",
            },
            state: {
              key: "serialNumber",
              defaultValue: "",
            },
          },
          {
            element: "Button",
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
      done: viewTextNode(),
    },
  })
  const issues = validateEditedRoot<RootWithNamespacesAndRoutes>((root, bundle) => {
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
        function: "done",
        args: {
          view: "$outputs.0",
        },
      },
    }
    return replaceBundleResources(root, bundle, { uiBytes })
  })

  assert.deepEqual(issueLocations(issues), [
    ["CAM_UI_TYPEFLOW_MISMATCH", "nodes.app.children.1.call.args.serialNumber"],
  ])
})

test("UI literal TextField state keys must be state expression identifiers", () => {
  const uiBytes = jsonBytes({
    ui: UI_VERSION,
    nodes: {
      app: {
        element: "Text",
        requires: ["view"],
        props: {
          text: "valid app node",
        },
      },
      empty: {
        element: "TextField",
        requires: [],
        props: {
          label: "Empty",
        },
        state: {
          key: "",
          defaultValue: "",
        },
      },
      invalid: {
        element: "TextField",
        requires: ["view"],
        props: {
          label: "Serial number",
        },
        state: {
          key: "serial-number",
          defaultValue: "",
        },
      },
    },
  })
  const issues = validateEditedRoot<RootWithNamespaces>((root, bundle) => {
    return replaceBundleResources(root, bundle, { uiBytes })
  })

  assert.deepEqual(issueLocations(issues), [
    ["CAM_UI_DATAFLOW_MISMATCH", "nodes.empty.state.key"],
    ["CAM_UI_DATAFLOW_MISMATCH", "nodes.invalid.state.key"],
  ])
})

test("UI Button state references must be backed by route-local rendered inputs", () => {
  const uiBytes = jsonBytes({
    ui: UI_VERSION,
    nodes: {
      app: {
        element: "Fragment",
        requires: ["view"],
        children: [
          {
            element: "Include",
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
        element: "Button",
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
        element: "TextField",
        requires: ["view"],
        props: {
          label: "Serial number",
        },
        state: {
          key: "serialNumber",
          defaultValue: "",
        },
      },
      done: viewTextNode(),
    },
  })
  const issues = validateEditedRoot<RootWithNamespacesAndRoutes>((root, bundle) => {
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
        function: "done",
        args: {
          view: "$outputs.0",
        },
      },
    }
    return replaceBundleResources(root, bundle, { uiBytes })
  })

  assert.deepEqual(issueLocations(issues), [
    ["CAM_UI_TYPEFLOW_MISMATCH", "nodes.app.children.0.edit.call.args.serialNumber"],
  ])
})

test("UI Button state references may use inputs from the route root tree", () => {
  const uiBytes = jsonBytes({
    ui: UI_VERSION,
    nodes: {
      app: {
        element: "Fragment",
        requires: ["view"],
        children: [
          {
            element: "TextField",
            props: {
              label: "Serial number",
            },
            state: {
              key: "serialNumber",
              defaultValue: "",
            },
          },
          {
            element: "Include",
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
        element: "Button",
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
  const issues = validateEditedRoot<RootWithNamespacesAndRoutes>((root, bundle) => {
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

test("UI typeflow rejects duplicate rendered TextField state keys", () => {
  const uiBytes = jsonBytes({
    ui: UI_VERSION,
    nodes: {
      app: {
        element: "Fragment",
        requires: ["view"],
        children: [
          {
            element: "TextField",
            props: {
              label: "Serial number",
            },
            state: {
              key: "serialNumber",
              defaultValue: "",
            },
          },
          {
            element: "TextField",
            props: {
              label: "Duplicate serial number",
            },
            state: {
              key: "serialNumber",
              defaultValue: "",
            },
          },
        ],
      },
      done: viewTextNode(),
    },
  })
  const issues = validateEditedRoot<RootWithNamespaces>((root, bundle) => {
    return replaceBundleResources(root, bundle, { uiBytes })
  })

  assert.deepEqual(issueLocations(issues), [
    ["CAM_UI_TYPEFLOW_MISMATCH", "nodes.app.children.1.state.key"],
  ])
})

test("UI typeflow resolves handoff-backed TextField state keys", () => {
  const uiBytes = jsonBytes({
    ui: UI_VERSION,
    nodes: {
      app: {
        element: "Fragment",
        requires: ["view"],
        children: [
          {
            element: "TextField",
            props: {
              label: "Serial number",
            },
            state: {
              key: "$view.inputName",
              defaultValue: "",
            },
          },
          {
            element: "Button",
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
        ],
      },
      done: viewTextNode(),
    },
  })
  const issues = validateEditedRoot<RootWithNamespacesAndRoutes>((root, bundle) => {
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
        function: "done",
        args: {
          view: "$outputs.0",
        },
      },
    }
    root.routes.entry = {
      ...root.routes.entry,
      then: {
        namespace: "ui",
        function: "app",
        args: {
          view: {
            inputName: "serialNumber",
          },
        },
      },
    }
    return replaceBundleResources(root, bundle, { uiBytes })
  })

  assert.deepEqual(issues, [])
})

test("UI typeflow rejects handoff-backed invalid TextField state keys", () => {
  const uiBytes = jsonBytes({
    ui: UI_VERSION,
    nodes: {
      app: {
        element: "TextField",
        requires: ["view"],
        props: {
          label: "Serial number",
        },
        state: {
          key: "$view.inputName",
          defaultValue: "",
        },
      },
    },
  })
  const issues = validateEditedRoot<RootWithNamespacesAndRoutes>((root, bundle) => {
    root.routes.entry = {
      ...root.routes.entry,
      then: {
        namespace: "ui",
        function: "app",
        args: {
          view: {
            inputName: "serial-number",
          },
        },
      },
    }
    return replaceBundleResources(root, bundle, { uiBytes })
  })

  assert.deepEqual(issueLocations(issues), [
    ["CAM_UI_TYPEFLOW_MISMATCH", "nodes.app.state.key"],
  ])
})

test("UI typeflow rejects non-string TextField state defaults", () => {
  const uiBytes = jsonBytes({
    ui: UI_VERSION,
    nodes: {
      app: {
        element: "Fragment",
        requires: ["view"],
        children: [
          {
            element: "TextField",
            props: {
              label: "Literal",
            },
            state: {
              key: "literalDefault",
              defaultValue: 123,
            },
          },
          {
            element: "TextField",
            props: {
              label: "Route",
            },
            state: {
              key: "routeDefault",
              defaultValue: "$view.defaultValue",
            },
          },
        ],
      },
    },
  })
  const issues = validateEditedRoot<RootWithNamespacesAndRoutes>((root, bundle) => {
    root.routes.entry = {
      ...root.routes.entry,
      then: {
        namespace: "ui",
        function: "app",
        args: {
          view: {
            defaultValue: 123,
          },
        },
      },
    }
    return replaceBundleResources(root, bundle, { uiBytes })
  })

  assert.deepEqual(issueLocations(issues), [
    ["CAM_UI_TYPEFLOW_MISMATCH", "nodes.app.children.0.state.defaultValue"],
    ["CAM_UI_TYPEFLOW_MISMATCH", "nodes.app.children.1.state.defaultValue"],
  ])
})

test("UI typeflow keeps route-specific diagnostics distinct", () => {
  const uiBytes = jsonBytes({
    ui: UI_VERSION,
    nodes: {
      app: {
        element: "Button",
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
      done: viewTextNode(),
    },
  })
  const issues = validateEditedRoot<RootWithNamespacesAndRoutes>((root, bundle) => {
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
    root.routes.entry = {
      ...root.routes.entry,
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
    ["CAM_UI_TYPEFLOW_MISMATCH", "nodes.app.call.args.serialNumber"],
    ["CAM_UI_TYPEFLOW_MISMATCH", "nodes.app.call.args.serialNumber"],
  ])
  assert.deepEqual(issues.map((issue) => issue.message), [
    "route entry: UI Button references state without a matching route-local TextField state key: serialNumber",
    "route component: UI Button references state without a matching route-local TextField state key: serialNumber",
  ])
})

test("UI call arg names must not be empty", () => {
  const uiBytes = jsonBytes({
    ui: UI_VERSION,
    nodes: {
      app: {
        element: "Fragment",
        requires: ["view"],
        children: [
          {
            element: "Button",
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
            element: "Include",
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
        element: "Text",
        requires: ["view"],
        props: {
          text: "$view.title",
        },
      },
    },
  })
  const issues = validateEditedRoot<RootWithNamespaces>((root, bundle) => {
    return replaceBundleResources(root, bundle, { uiBytes })
  })

  assert.deepEqual(issueLocations(issues), [
    ["CAM_UI_DATAFLOW_MISMATCH", "nodes.app.children.0.call.args"],
    ["CAM_UI_DATAFLOW_MISMATCH", "nodes.app.children.1.call.args"],
  ])
})

test("UI Includes with literal targets must pass exactly the target node args", () => {
  const uiBytes = jsonBytes({
    ui: UI_VERSION,
    nodes: {
      app: {
        element: "Fragment",
        requires: ["view"],
        children: [
          {
            element: "Include",
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
        element: "Text",
        requires: ["view"],
        props: {
          text: "$view.title",
        },
      },
    },
  })
  const issues = validateEditedRoot<RootWithNamespaces>((root, bundle) => {
    return replaceBundleResources(root, bundle, { uiBytes })
  })

  assert.deepEqual(issueLocations(issues), [
    ["CAM_UI_DATAFLOW_MISMATCH", "nodes.app.children.0.call.args.extra"],
    ["CAM_UI_DATAFLOW_MISMATCH", "nodes.app.children.0.call.args.view"],
  ])
})

test("UI Include escaped call targets are checked as literal node names", () => {
  const uiBytes = jsonBytes({
    ui: UI_VERSION,
    nodes: {
      app: {
        element: "Fragment",
        requires: ["view"],
        children: [
          {
            element: "Include",
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
  const issues = validateEditedRoot<RootWithNamespaces>((root, bundle) => {
    return replaceBundleResources(root, bundle, { uiBytes })
  })

  assert.deepEqual(issueLocations(issues), [
    ["CAM_UI_DATAFLOW_MISMATCH", "nodes.app.children.0.call.function"],
  ])
})

test("UI known call targets must not be empty or duplicated", () => {
  const uiBytes = jsonBytes({
    ui: UI_VERSION,
    nodes: {
      app: {
        element: "Fragment",
        requires: ["view"],
        children: [
          {
            element: "Include",
            call: {
              namespace: "ui",
              function: ["detail", "detail"],
              args: {
                view: "$view",
              },
            },
          },
          {
            element: "Include",
            call: {
              namespace: "ui",
              function: "",
              args: {},
            },
          },
          {
            element: "Button",
            props: {
              label: "Open",
            },
            call: {
              namespace: "routes",
              function: "",
              args: {},
            },
          },
        ],
      },
      detail: {
        element: "Text",
        requires: ["view"],
        props: {
          text: "$view.title",
        },
      },
    },
  })
  const issues = validateEditedRoot<RootWithNamespaces>((root, bundle) => {
    return replaceBundleResources(root, bundle, { uiBytes })
  })

  assert.deepEqual(issueLocations(issues), [
    ["CAM_UI_DATAFLOW_MISMATCH", "nodes.app.children.0.call.function"],
    ["CAM_UI_DATAFLOW_MISMATCH", "nodes.app.children.1.call.function"],
    ["CAM_UI_TYPEFLOW_MISMATCH", "nodes.app.children.2.call.function"],
  ])
})

test("UI Includes must not shadow runtime roots even when the target is dynamic", () => {
  const uiBytes = jsonBytes({
    ui: UI_VERSION,
    nodes: {
      app: {
        element: "Fragment",
        requires: ["view"],
        children: [
          {
            element: "Include",
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
  const issues = validateEditedRoot<RootWithNamespaces>((root, bundle) => {
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
    ui: UI_VERSION,
    nodes: {
      app: {
        element: "Fragment",
        requires: ["view"],
        children: [
          {
            element: "Address",
            props: {
              label: "Owner",
              address: "$view.owner",
            },
          },
          {
            element: "Text",
            props: {
              text: "$view.missingTitle",
            },
          },
        ],
      },
    },
  })
  const issues = validateEditedRoot<RootWithNamespaces>((root, bundle) => {
    return replaceBundleResources(root, bundle, { abiBytes, uiBytes })
  })

  assert.deepEqual(issueLocations(issues), [
    ["CAM_UI_TYPEFLOW_MISMATCH", "nodes.app.children.0.props.address"],
    ["CAM_UI_TYPEFLOW_MISMATCH", "nodes.app.children.1.props.text"],
  ])
})

test("UI props reject invalid literal addresses", () => {
  const uiBytes = jsonBytes({
    ui: UI_VERSION,
    nodes: {
      app: {
        element: "Address",
        requires: ["view"],
        props: {
          label: "Owner",
          address: "$$not-an-address",
        },
      },
    },
  })
  const issues = validateEditedRoot<RootWithNamespaces>((root, bundle) => {
    return replaceBundleResources(root, bundle, { uiBytes })
  })

  assert.deepEqual(issueLocations(issues), [
    ["CAM_UI_TYPEFLOW_MISMATCH", "nodes.app.props.address"],
  ])
})

test("UI props reject statically incompatible literal route handoff args", () => {
  const uiBytes = jsonBytes({
    ui: UI_VERSION,
    nodes: {
      app: {
        element: "Address",
        requires: ["view"],
        props: {
          label: "Owner",
          address: "$view.owner",
        },
      },
    },
  })
  const issues = validateEditedRoot<RootWithNamespacesAndRoutes>((root, bundle) => {
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

test("UI props reject invalid literal address strings passed through route handoff args", () => {
  const uiBytes = jsonBytes({
    ui: UI_VERSION,
    nodes: {
      app: {
        element: "Address",
        requires: ["view"],
        props: {
          label: "Owner",
          address: "$view.owner",
        },
      },
    },
  })
  const issues = validateEditedRoot<RootWithNamespacesAndRoutes>((root, bundle) => {
    root.routes.entry = {
      ...root.routes.entry,
      then: {
        namespace: "ui",
        function: "app",
        args: {
          view: {
            owner: "not-an-address",
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

test("UI props accept valid literal address strings passed through route handoff args", () => {
  const uiBytes = jsonBytes({
    ui: UI_VERSION,
    nodes: {
      app: {
        element: "Address",
        requires: ["view"],
        props: {
          label: "Owner",
          address: "$view.owner",
        },
      },
    },
  })
  const issues = validateEditedRoot<RootWithNamespacesAndRoutes>((root, bundle) => {
    root.routes.entry = {
      ...root.routes.entry,
      then: {
        namespace: "ui",
        function: "app",
        args: {
          view: {
            owner: "0x0000000000000000000000000000000000000001",
          },
        },
      },
    }
    return replaceBundleResources(root, bundle, { uiBytes })
  })

  assert.deepEqual(issues, [])
})

test("UI typeflow preserves literal handoff field names over ABI output names", () => {
  const abiBytes = jsonBytes([
    {
      type: "function",
      name: "viewEntry",
      stateMutability: "view",
      inputs: [],
      outputs: [
        {
          name: "result",
          type: "address",
        },
      ],
    },
  ])
  const uiBytes = jsonBytes({
    ui: UI_VERSION,
    nodes: {
      app: {
        element: "Address",
        requires: ["view"],
        props: {
          label: "Owner",
          address: "$view.owner",
        },
      },
    },
  })
  const issues = validateEditedRoot<RootWithNamespacesAndRoutes>((root, bundle) => {
    root.routes.entry = {
      ...root.routes.entry,
      then: {
        namespace: "ui",
        function: "app",
        args: {
          view: {
            owner: "$outputs.0",
          },
        },
      },
    }
    return replaceBundleResources(root, bundle, { abiBytes, uiBytes })
  })

  assert.deepEqual(issues, [])
})

test("UI props reject statically incompatible literal Include args", () => {
  const uiBytes = jsonBytes({
    ui: UI_VERSION,
    nodes: {
      app: {
        element: "Fragment",
        requires: ["view"],
        children: [
          {
            element: "Include",
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
        element: "Address",
        requires: ["view"],
        props: {
          label: "Owner",
          address: "$view.owner",
        },
      },
    },
  })
  const issues = validateEditedRoot<RootWithNamespaces>((root, bundle) => {
    return replaceBundleResources(root, bundle, { uiBytes })
  })

  assert.deepEqual(issueLocations(issues), [
    ["CAM_UI_TYPEFLOW_MISMATCH", "nodes.app.children.0.ownerPanel.props.address"],
  ])
})

test("UI call args reject route-local missing references at publication time", () => {
  const abiBytes = jsonBytes([
    viewEntryFunction(),
    {
      type: "function",
      name: "saveSerial",
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
  const uiBytes = jsonBytes({
    ui: UI_VERSION,
    nodes: {
      app: {
        element: "Fragment",
        requires: ["view"],
        children: [
          {
            element: "Include",
            call: {
              namespace: "ui",
              function: "summary",
              args: {
                view: "$view.missing",
              },
            },
          },
          {
            element: "Button",
            props: {
              label: "Save",
            },
            call: {
              namespace: "routes",
              function: "saveSerial",
              args: {
                serialNumber: "$view.missing",
              },
            },
          },
        ],
      },
      summary: {
        element: "Text",
        requires: ["view"],
        props: {
          text: "$view.title",
        },
      },
    },
  })
  const issues = validateEditedRoot<RootWithNamespacesAndRoutes>((root, bundle) => {
    root.routes.saveSerial = {
      kind: "write",
      inputs: ["serialNumber"],
      call: {
        namespace: "contracts.App",
        function: "saveSerial",
        args: {
          serialNumber: "$inputs.serialNumber",
        },
      },
      then: {
        namespace: "routes",
        function: "entry",
        args: {},
      },
    }
    return replaceBundleResources(root, bundle, { abiBytes, uiBytes })
  })

  assert.deepEqual(issueLocations(issues), [
    ["CAM_UI_TYPEFLOW_MISMATCH", "nodes.app.children.0.call.args.view"],
    ["CAM_UI_TYPEFLOW_MISMATCH", "nodes.app.children.1.call.args.serialNumber"],
  ])
})

test("UI Includes reject deterministically invalid literal route handoff selectors", () => {
  const uiBytes = jsonBytes({
    ui: UI_VERSION,
    nodes: {
      app: {
        element: "Include",
        requires: ["view"],
        call: {
          namespace: "ui",
          function: "$view.nodes",
          args: {},
        },
      },
      item: {
        element: "Text",
        requires: [],
        props: {
          text: "Item",
        },
      },
    },
  })
  const issues = validateEditedRoot<RootWithNamespacesAndRoutes>((root, bundle) => {
    root.routes.entry = {
      ...root.routes.entry,
      then: {
        namespace: "ui",
        function: "app",
        args: {
          view: {
            nodes: ["item", "item"],
          },
        },
      },
    }
    return replaceBundleResources(root, bundle, { uiBytes })
  })

  assert.deepEqual(issueLocations(issues), [
    ["CAM_UI_TYPEFLOW_MISMATCH", "nodes.app.call.function"],
  ])
})

test("UI Includes resolve escaped route handoff selectors before validation", () => {
  const uiBytes = jsonBytes({
    ui: UI_VERSION,
    nodes: {
      app: {
        element: "Include",
        requires: ["view"],
        call: {
          namespace: "ui",
          function: "$view.nodes",
          args: {},
        },
      },
      "$$item": {
        element: "Text",
        requires: [],
        props: {
          text: "Wrong spelling",
        },
      },
    },
  })
  for (const nodes of ["$$item", ["$$item"]]) {
    const issues = validateEditedRoot<RootWithNamespacesAndRoutes>((root, bundle) => {
      root.routes.entry = {
        ...root.routes.entry,
        then: {
          namespace: "ui",
          function: "app",
          args: {
            view: {
              nodes,
            },
          },
        },
      }
      return replaceBundleResources(root, bundle, { uiBytes })
    })

    assert.deepEqual(issueLocations(issues), [
      ["CAM_UI_TYPEFLOW_MISMATCH", "nodes.app.call.function"],
    ])
  }
})

test("UI Includes reject deterministically invalid literal Include arg selectors", () => {
  const uiBytes = jsonBytes({
    ui: UI_VERSION,
    nodes: {
      app: {
        element: "Include",
        requires: [],
        call: {
          namespace: "ui",
          function: "panel",
          args: {
            view: {
              nodes: "",
            },
          },
        },
      },
      panel: {
        element: "Include",
        requires: ["view"],
        call: {
          namespace: "ui",
          function: "$view.nodes",
          args: {},
        },
      },
    },
  })
  const issues = validateEditedRoot<RootWithNamespacesAndRoutes>((root, bundle) => {
    root.routes.entry = {
      ...root.routes.entry,
      then: {
        namespace: "ui",
        function: "app",
        args: {},
      },
    }
    return replaceBundleResources(root, bundle, { uiBytes })
  })

  assert.deepEqual(issueLocations(issues), [
    ["CAM_UI_TYPEFLOW_MISMATCH", "nodes.app.panel.call.function"],
  ])
})

test("UI Includes validate known targets from mixed selector lists", () => {
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
              name: "dynamicNode",
              type: "string",
            },
          ],
        },
      ],
    },
  ])
  const uiBytes = jsonBytes({
    ui: UI_VERSION,
    nodes: {
      app: {
        element: "Include",
        requires: ["view"],
        call: {
          namespace: "ui",
          function: ["ownerPanel", "$view.dynamicNode"],
          args: {
            view: {
              owner: 123,
            },
          },
        },
      },
      ownerPanel: {
        element: "Address",
        requires: ["view"],
        props: {
          label: "Owner",
          address: "$view.owner",
        },
      },
    },
  })
  const issues = validateEditedRoot<RootWithNamespacesAndRoutes>((root, bundle) => {
    root.routes.entry = {
      ...root.routes.entry,
      then: {
        namespace: "ui",
        function: "app",
        args: {
          view: {
            dynamicNode: "$outputs.0.dynamicNode",
          },
        },
      },
    }
    return replaceBundleResources(root, bundle, { abiBytes, uiBytes })
  })

  assert.deepEqual(issueLocations(issues), [
    ["CAM_UI_TYPEFLOW_MISMATCH", "nodes.app.ownerPanel.props.address"],
  ])
})

test("route root UI node must resolve to exactly one root node", () => {
  const routeRootIssues = (functionValue: unknown, extraNodes: Record<string, unknown>) => {
    return validateEditedRoot<RootWithNamespaces>((root, bundle) => {
      const uiBytes = jsonBytes({
        ui: UI_VERSION,
        nodes: {
          app: {
            element: "Include",
            requires: ["view"],
            call: {
              namespace: "ui",
              function: functionValue,
              args: {
                view: "$view",
              },
            },
          },
          ...extraNodes,
        },
      })
      return replaceBundleResources(root, bundle, { uiBytes })
    })
  }

  const multipleRootIssues = routeRootIssues(["summary", "actions"], {
    summary: {
      element: "Text",
      requires: ["view"],
      props: {
        text: "$view.title",
      },
    },
    actions: {
      element: "Button",
      requires: ["view"],
      props: {
        label: "Refresh",
      },
      call: {
        namespace: "routes",
        function: "entry",
        args: {},
      },
    },
  })
  const emptyRootIssues = routeRootIssues([], {})

  assert.deepEqual(issueLocations(multipleRootIssues), [
    ["CAM_UI_TYPEFLOW_MISMATCH", "nodes.app.call.function"],
  ])
  assert.deepEqual(issueLocations(emptyRootIssues), [
    ["CAM_UI_TYPEFLOW_MISMATCH", "nodes.app.call.function"],
  ])
})

test("route root cardinality is not reported when Include target is missing", () => {
  const uiBytes = jsonBytes({
    ui: UI_VERSION,
    nodes: {
      app: {
        element: "Include",
        requires: ["view"],
        call: {
          namespace: "ui",
          function: "$view.nodes",
          args: {
            view: "$view",
          },
        },
      },
      summary: {
        element: "Text",
        requires: ["view"],
        props: {
          text: "$view.title",
        },
      },
    },
  })
  const issues = validateEditedRoot<RootWithNamespacesAndRoutes>((root, bundle) => {
    root.routes.entry = {
      ...root.routes.entry,
      then: {
        namespace: "ui",
        function: "app",
        args: {
          view: {
            nodes: ["summary", "missing"],
            title: "Component",
          },
        },
      },
    }
    return replaceBundleResources(root, bundle, { uiBytes })
  })

  assert.deepEqual(issueLocations(issues), [
    ["CAM_UI_TYPEFLOW_MISMATCH", "nodes.app.call.function"],
  ])
})

test("UI typeflow rejects deterministic Include cycles", () => {
  const uiBytes = jsonBytes({
    ui: UI_VERSION,
    nodes: {
      app: {
        element: "Include",
        requires: ["view"],
        call: {
          namespace: "ui",
          function: "app",
          args: {
            view: "$view",
          },
        },
      },
    },
  })
  const issues = validateEditedRoot<RootWithNamespaces>((root, bundle) => {
    return replaceBundleResources(root, bundle, { uiBytes })
  })

  assert.deepEqual(issueLocations(issues), [
    ["CAM_UI_TYPEFLOW_MISMATCH", "nodes.app.app"],
  ])
})

test("UI Includes validate resolved selector targets and args", () => {
  const uiBytes = jsonBytes({
    ui: UI_VERSION,
    nodes: {
      app: {
        element: "Fragment",
        requires: ["view"],
        children: [
          {
            element: "Include",
            call: {
              namespace: "ui",
              function: "$view.missing",
              args: {},
            },
          },
          {
            element: "Include",
            call: {
              namespace: "ui",
              function: "$view.detail",
              args: {},
            },
          },
        ],
      },
      detail: {
        element: "Text",
        requires: ["view"],
        props: {
          text: "$view.title",
        },
      },
    },
  })
  const issues = validateEditedRoot<RootWithNamespacesAndRoutes>((root, bundle) => {
    root.routes.entry = {
      ...root.routes.entry,
      then: {
        namespace: "ui",
        function: "app",
        args: {
          view: {
            missing: "missing",
            detail: "detail",
          },
        },
      },
    }
    return replaceBundleResources(root, bundle, { uiBytes })
  })

  assert.deepEqual(issueLocations(issues), [
    ["CAM_UI_TYPEFLOW_MISMATCH", "nodes.app.children.0.call.function"],
    ["CAM_UI_TYPEFLOW_MISMATCH", "nodes.app.children.1.call.args.view"],
  ])
})

test("UI typeflow walks literal Include arrays", () => {
  const uiBytes = jsonBytes({
    ui: UI_VERSION,
    nodes: {
      app: {
        element: "Include",
        requires: ["view"],
        call: {
          namespace: "ui",
          function: ["ownerPanel"],
          args: {
            view: {
              owner: 123,
            },
          },
        },
      },
      ownerPanel: {
        element: "Address",
        requires: ["view"],
        props: {
          label: "Owner",
          address: "$view.owner",
        },
      },
    },
  })
  const issues = validateEditedRoot<RootWithNamespaces>((root, bundle) => {
    return replaceBundleResources(root, bundle, { uiBytes })
  })

  assert.deepEqual(issueLocations(issues), [
    ["CAM_UI_TYPEFLOW_MISMATCH", "nodes.app.ownerPanel.props.address"],
  ])
})

test("UI typeflow validates handoff-backed Button routes", () => {
  const uiBytes = jsonBytes({
    ui: UI_VERSION,
    nodes: {
      app: {
        element: "Button",
        requires: ["view"],
        props: {
          label: "Open",
        },
        call: {
          namespace: "routes",
          function: "$view.route",
          args: {},
        },
      },
      done: viewTextNode(),
    },
  })
  const issues = validateEditedRoot<RootWithNamespacesAndRoutes>((root, bundle) => {
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
        function: "done",
        args: {
          view: "$outputs.0",
        },
      },
    }
    root.routes.entry = {
      ...root.routes.entry,
      then: {
        namespace: "ui",
        function: "app",
        args: {
          view: {
            route: "component",
          },
        },
      },
    }
    return replaceBundleResources(root, bundle, { uiBytes })
  })

  assert.deepEqual(issueLocations(issues), [
    ["CAM_UI_TYPEFLOW_MISMATCH", "nodes.app.call.args.serialNumber"],
  ])
})

test("UI typeflow rejects handoff-backed empty Button routes", () => {
  const uiBytes = jsonBytes({
    ui: UI_VERSION,
    nodes: {
      app: {
        element: "Button",
        requires: ["view"],
        props: {
          label: "Open",
        },
        call: {
          namespace: "routes",
          function: "$view.route",
          args: {},
        },
      },
    },
  })
  const issues = validateEditedRoot<RootWithNamespacesAndRoutes>((root, bundle) => {
    root.routes.entry = {
      ...root.routes.entry,
      then: {
        namespace: "ui",
        function: "app",
        args: {
          view: {
            route: "",
          },
        },
      },
    }
    return replaceBundleResources(root, bundle, { uiBytes })
  })

  assert.deepEqual(issueLocations(issues), [
    ["CAM_UI_TYPEFLOW_MISMATCH", "nodes.app.call.function"],
  ])
})

test("UI typeflow checks state references through resolved Include selectors", () => {
  const uiBytes = jsonBytes({
    ui: UI_VERSION,
    nodes: {
      app: {
        element: "Include",
        requires: ["view"],
        call: {
          namespace: "ui",
          function: "$view.nodes",
          args: {
            view: "$view",
          },
        },
      },
      done: viewTextNode(),
      edit: {
        element: "Button",
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
  const issues = validateEditedRoot<RootWithNamespacesAndRoutes>((root, bundle) => {
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
        function: "done",
        args: {
          view: "$outputs.0",
        },
      },
    }
    root.routes.entry = {
      ...root.routes.entry,
      then: {
        namespace: "ui",
        function: "app",
        args: {
          view: {
            nodes: "edit",
          },
        },
      },
    }
    return replaceBundleResources(root, bundle, { uiBytes })
  })

  assert.deepEqual(issueLocations(issues), [
    ["CAM_UI_TYPEFLOW_MISMATCH", "nodes.app.edit.call.args.serialNumber"],
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
    ui: UI_VERSION,
    nodes: {
      app: {
        element: "Address",
        requires: ["view"],
        props: {
          label: "Owner",
          address: "$view.owner",
        },
      },
    },
  })
  const issues = validateEditedRoot<RootWithNamespacesAndRoutes>((root, bundle) => {
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

test("UI expression call targets reject statically incompatible ABI-backed route outputs", () => {
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
    ui: UI_VERSION,
    nodes: {
      app: {
        element: "Fragment",
        requires: ["view"],
        children: [
          {
            element: "Include",
            call: {
              namespace: "ui",
              function: "$view.viewId",
              args: {
                view: "$view",
              },
            },
          },
          {
            element: "Button",
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
  const issues = validateEditedRoot<RootWithNamespaces>((root, bundle) => {
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
  ])
})

test("resource declarations reject mutable remote and escaping URIs", () => {
  const issues = validateEditedRoot<RootWithNamespaces>((root) => {
    root.namespaces["contracts.App"].abiURI = "https://example.test/App.json"
    root.namespaces["contracts.Other"] = {
      type: "contract",
      abiURI: "./",
      integrity: ZERO_SHA256_INTEGRITY,
    }
    root.namespaces["contracts.Ipfs"] = {
      type: "contract",
      abiURI: "ipfs://../App.json",
      integrity: ZERO_SHA256_INTEGRITY,
    }
    root.namespaces["contracts.Encoded"] = {
      type: "contract",
      abiURI: "./%2e%2e/App.json",
      integrity: ZERO_SHA256_INTEGRITY,
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

test("declared resources must not exceed the protocol resource size cap", () => {
  const oversizedAbiBytes = new Uint8Array(CAM_RESOURCE_MAX_BYTES + 1)
  const issues = validateEditedRoot<RootWithNamespaces>((root, bundle) => {
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
      integrity: ZERO_SHA256_INTEGRITY,
    }
  })

  assert.equal(issues[0]?.rule, "CAM_RESOURCE_INTEGRITY_CONFLICT")
  assert.equal(issues[0]?.resource, "./abi/App.json")
  assert.equal(issues[0]?.path, "namespaces.contracts.Other.integrity")
})

test("missing UI namespace is reported with dependent route incompatibility", () => {
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
    "CAM_UI_NAMESPACE_MISSING",
    "CAM_ROUTE_INVOCATION_INVALID",
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
    root.namespaces["contracts.App.v1"] = {
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
    ["CAM_NAMESPACE_DECLARATION_INVALID", "namespaces.contracts.App.v1"],
    ["CAM_NAMESPACE_DECLARATION_INVALID", "namespaces.widgets.type"],
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
  ])
})

test("UI resource integrity mismatch returns one precise issue", () => {
  const issues = validateCamBundle(minimalBundleWithUiIntegrity(
    ZERO_SHA256_INTEGRITY,
  ))

  assert.equal(issues.length, 1)
  assert.equal(issues[0]?.rule, "CAM_RESOURCE_INTEGRITY_MISMATCH")
  assert.equal(issues[0]?.severity, "error")
  assert.equal(issues[0]?.resource, "./ui.json")
  assert.equal(issues[0]?.path, "namespaces.ui.integrity")
  const issue = issues[0]
  assert.notEqual(issue, undefined)
  assert.match(issue.message, /CAM resource integrity mismatch/)
})
