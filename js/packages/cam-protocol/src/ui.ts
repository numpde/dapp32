// Named UI nodes expose a deliberately tiny call interface. Keep shared UI
// vocabulary here so CAM screen parsing and conformance use one source.
export const UI_NODE_ARGUMENT_KEYS: ReadonlySet<string> = new Set(["view"])

export const UI_CONTEXT_KEYS: ReadonlySet<string> = new Set(["host", "account", "inputs", "outputs", "state", "view"])
export const UI_RUNTIME_ROOTS: ReadonlySet<string> = new Set(["host", "account", "inputs", "outputs", "state"])
