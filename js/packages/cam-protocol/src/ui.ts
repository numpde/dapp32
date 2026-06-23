import {
  CAM_ROUTES_NAMESPACE,
  CAM_UI_NAMESPACE,
} from "./namespaces.ts"
import {
  CAM_ROUTE_CONTEXT_KEYS,
} from "./runtime-context.ts"

// Named UI nodes expose a deliberately tiny call interface. Keep shared UI
// vocabulary here so UI parsing and conformance use one source.
export const UI_NODE_ARGUMENT_KEYS: ReadonlySet<string> = new Set(["view"])

// UI roots extend route roots: route data remains available while rendering,
// then UI adds local state and the current view handoff payload.
export const UI_CONTEXT_KEYS: ReadonlySet<string> = new Set([...CAM_ROUTE_CONTEXT_KEYS, "state", "view"])
export const UI_RUNTIME_ROOTS: ReadonlySet<string> = new Set([...CAM_ROUTE_CONTEXT_KEYS, "state"])

// UI document keys are shared publication vocabulary. Node/body field sets stay
// with the renderer parser because conformance should not mirror every parser
// diagnostic unless the rule has independent publication value.
export const UI_DOCUMENT_TOP_LEVEL_KEYS: ReadonlySet<string> = new Set(["ui", "nodes"])

// These elements are protocol-level call edges, not renderer preferences:
// Include composes UI nodes, Button hands off to CAM routes.
export const UI_CALL_NAMESPACE_BY_ELEMENT = {
  Include: CAM_UI_NAMESPACE,
  Button: CAM_ROUTES_NAMESPACE,
} as const
export type UiCallElement = keyof typeof UI_CALL_NAMESPACE_BY_ELEMENT
export type UiCallNamespace = (typeof UI_CALL_NAMESPACE_BY_ELEMENT)[UiCallElement]

export function uiCallNamespaceForElement(value: unknown): UiCallNamespace | undefined {
  if (typeof value !== "string" || !Object.hasOwn(UI_CALL_NAMESPACE_BY_ELEMENT, value)) {
    return undefined
  }

  return UI_CALL_NAMESPACE_BY_ELEMENT[value as UiCallElement]
}

// `string` is the syntactic UI contract; narrower buckets like `address` are
// semantic contracts that every renderer/resolver must enforce once concrete.
export const UI_PROP_SCHEMAS = {
  Screen: {
    required: ["title"],
    string: ["title"],
    address: [],
  },
  Text: {
    required: ["text"],
    string: ["text"],
    address: [],
  },
  TextField: {
    required: ["label"],
    string: ["label"],
    address: [],
  },
  Address: {
    required: ["label", "address"],
    string: ["label", "address"],
    address: ["address"],
  },
  Status: {
    required: ["label", "value"],
    string: ["label"],
    address: [],
  },
  Nft: {
    required: ["contractAddress", "tokenId"],
    string: ["contractAddress"],
    address: ["contractAddress"],
  },
  Button: {
    required: ["label"],
    string: ["label"],
    address: [],
  },
} as const

export type UiPropElement = keyof typeof UI_PROP_SCHEMAS

export function isUiPropElement(value: string): value is UiPropElement {
  return Object.hasOwn(UI_PROP_SCHEMAS, value)
}
