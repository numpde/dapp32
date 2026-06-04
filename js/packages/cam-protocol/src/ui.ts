// Named UI nodes expose a deliberately tiny call interface. Keep shared UI
// vocabulary here so CAM screen parsing and conformance use one source.
export const UI_NODE_ARGUMENT_KEYS: ReadonlySet<string> = new Set(["view"])

export const UI_CONTEXT_KEYS: ReadonlySet<string> = new Set(["host", "account", "inputs", "outputs", "state", "view"])
export const UI_RUNTIME_ROOTS: ReadonlySet<string> = new Set(["host", "account", "inputs", "outputs", "state"])

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
