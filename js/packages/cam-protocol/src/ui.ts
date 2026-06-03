// Named UI nodes expose a deliberately tiny call interface. Keep the allowed
// argument names here so CAM screen parsing and conformance use one vocabulary.
export const UI_NODE_ARGUMENT_KEYS: ReadonlySet<string> = new Set(["view"])
