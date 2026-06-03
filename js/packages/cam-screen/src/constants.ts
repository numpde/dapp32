import {
  CAM_ROUTES_NAMESPACE,
  CAM_UI_NAMESPACE,
  UI_NODE_ARGUMENT_KEYS,
} from "@cam/protocol"

export {
  CAM_ROUTES_NAMESPACE,
  CAM_UI_NAMESPACE,
  UI_NODE_ARGUMENT_KEYS,
}

export const UI_VERSION = "1.0.0"

export const UI_CONTEXT_KEYS: ReadonlySet<string> = new Set(["host", "account", "inputs", "outputs", "form", "view"])
export const UI_RUNTIME_ROOTS: ReadonlySet<string> = new Set(["host", "account", "inputs", "outputs", "form"])

export const UI_PROP_SCHEMAS = {
  Screen: {
    required: ["title"],
    string: ["title"],
  },
  Text: {
    required: ["text"],
    string: ["text"],
  },
  Input: {
    required: ["name", "label", "value"],
    string: ["name", "label", "value"],
  },
  Address: {
    required: ["label", "address"],
    string: ["label", "address"],
  },
  Status: {
    required: ["label", "value"],
    string: ["label"],
  },
  Nft: {
    required: ["contractAddress", "tokenId"],
    string: ["contractAddress"],
  },
  Action: {
    required: ["label"],
    string: ["label"],
  },
} as const

export type UiPropTag = keyof typeof UI_PROP_SCHEMAS
