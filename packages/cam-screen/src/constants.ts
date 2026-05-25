export const SCREEN_VERSION = "1.0.0"

export const SCREEN_CONTEXT_ROOTS = ["host", "account", "params", "state", "values"] as const
export const SCREEN_CONTEXT_KEYS: ReadonlySet<string> = new Set(SCREEN_CONTEXT_ROOTS)
