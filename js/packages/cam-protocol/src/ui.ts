// Named UI nodes expose a deliberately tiny call interface. Keep shared UI
// vocabulary here so UI parsing and conformance use one source.
export const UI_NODE_ARGUMENT_KEYS: ReadonlySet<string> = new Set(["view"])

export const UI_CONTEXT_KEYS: ReadonlySet<string> = new Set(["host", "account", "inputs", "outputs", "state", "view"])
export const UI_RUNTIME_ROOTS: ReadonlySet<string> = new Set(["host", "account", "inputs", "outputs", "state"])

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
