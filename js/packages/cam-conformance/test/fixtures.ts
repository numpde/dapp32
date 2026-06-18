import { createHash } from "node:crypto"
import { parseJsonText } from "@cam/protocol"

import {
  validateCamBundle,
} from "../src/index.ts"
import type {
  CamConformanceBundle,
  CamConformanceIssue,
} from "../src/index.ts"

const encoder = new TextEncoder()
const decoder = new TextDecoder()

export type RootWithNamespaces = {
  readonly namespaces: Record<string, Record<string, unknown>>
}

export type RootWithRoutes = {
  readonly routes: Record<string, Record<string, unknown>>
}

export type RootWithNamespacesAndRoutes = RootWithNamespaces & RootWithRoutes

export function minimalBundle(overrides: {
  readonly uiIntegrity?: string
} = {}): CamConformanceBundle {
  const uiBytes = jsonBytes({
    ui: "1.0.0",
    nodes: {
      app: {
        element: "Text",
        requires: ["view"],
        props: {
          text: "$view.title",
        },
      },
    },
  })
  const abiBytes = jsonBytes([
    viewEntryFunction(),
  ])
  const rootBytes = jsonBytes({
    cam: "1.0.0",
    entry: "entry",
    namespaces: {
      "contracts.App": {
        type: "contract",
        abiURI: "./abi/App.json",
        integrity: sha256Integrity(abiBytes),
      },
      routes: {
        type: "routes",
      },
      ui: {
        type: "ui",
        uri: "./ui.json",
        integrity: uiIntegrity(overrides, uiBytes),
      },
    },
    routes: {
      entry: {
        kind: "read",
        inputs: [],
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
      },
    },
  })

  return {
    rootURI: "file:///bundle/root.json",
    rootBytes,
    resources: new Map([
      ["./abi/App.json", abiBytes],
      ["./ui.json", uiBytes],
    ]),
  }
}

export function viewOutput(): Record<string, unknown> {
  return {
    name: "view",
    type: "tuple",
    components: [
      {
        name: "title",
        type: "string",
      },
    ],
  }
}

export function viewEntryFunction(): Record<string, unknown> {
  return {
    type: "function",
    name: "viewEntry",
    stateMutability: "view",
    inputs: [],
    outputs: [viewOutput()],
  }
}

export function overloadedViewEntryAbiBytes(): Uint8Array {
  return jsonBytes([
    viewEntryFunction(),
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
}

export function duplicateViewEntrySignatureAbiBytes(): Uint8Array {
  return jsonBytes([
    viewEntryFunction(),
    viewEntryFunction(),
  ])
}

export function abiIssueLocationsFor(abiBytes: Uint8Array): readonly (readonly [string, string | undefined])[] {
  const issues = validateEditedRoot<{
    readonly namespaces: Record<string, Record<string, unknown>>
  }>((root, bundle) => {
    return replaceBundleResources(root, bundle, { abiBytes })
  })

  return issueLocations(issues).filter(([rule]) => rule === "CAM_ABI_INVALID")
}

function mutableRoot<T extends Record<string, unknown> = Record<string, unknown>>(bundle: CamConformanceBundle): T {
  return parseJsonText(decoder.decode(bundle.rootBytes)) as T
}

export function mustGetResource(bundle: CamConformanceBundle, uri: string): Uint8Array {
  const bytes = bundle.resources.get(uri)
  if (bytes === undefined) {
    throw new Error(`test fixture missing resource: ${uri}`)
  }
  return bytes
}

export function validateEditedRoot<T extends Record<string, unknown> = Record<string, unknown>>(
  edit: (root: T, bundle: CamConformanceBundle) => Pick<Partial<CamConformanceBundle>, "resources"> | void,
): readonly CamConformanceIssue[] {
  const bundle = minimalBundle()
  const root = mutableRoot<T>(bundle)
  const overrides = edit(root, bundle)
  if (overrides === undefined) {
    return validateCamBundle({
      ...bundle,
      rootBytes: jsonBytes(root),
    })
  }

  return validateCamBundle({
    ...bundle,
    ...overrides,
    rootBytes: jsonBytes(root),
  })
}

export function replaceBundleResources(
  root: { readonly namespaces: Record<string, Record<string, unknown>> },
  bundle: CamConformanceBundle,
  replacements: {
    readonly abiBytes?: Uint8Array
    readonly uiBytes?: Uint8Array
  },
): Pick<Partial<CamConformanceBundle>, "resources"> {
  const resources = new Map(bundle.resources)

  if (replacements.abiBytes !== undefined) {
    root.namespaces["contracts.App"].integrity = sha256Integrity(replacements.abiBytes)
    resources.set("./abi/App.json", replacements.abiBytes)
  }

  if (replacements.uiBytes !== undefined) {
    root.namespaces.ui.integrity = sha256Integrity(replacements.uiBytes)
    resources.set("./ui.json", replacements.uiBytes)
  }

  return { resources }
}

export function issueRules(issues: readonly CamConformanceIssue[]): readonly string[] {
  return issues.map((issue) => issue.rule)
}

export function issueLocations(issues: readonly CamConformanceIssue[]): readonly (readonly [string, string | undefined])[] {
  return issues.map((issue) => [issue.rule, issue.path])
}

export function jsonBytes(value: unknown): Uint8Array {
  return encoder.encode(JSON.stringify(value))
}

export function sha256Integrity(bytes: Uint8Array): string {
  return `sha256:0x${createHash("sha256").update(bytes).digest("hex")}`
}

function uiIntegrity(overrides: { readonly uiIntegrity?: string }, uiBytes: Uint8Array): string {
  if (overrides.uiIntegrity !== undefined) {
    return overrides.uiIntegrity
  }

  return sha256Integrity(uiBytes)
}
