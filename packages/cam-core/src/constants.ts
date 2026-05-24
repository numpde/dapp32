export const CAM_VERSION = "1.0.0"

export const CAM_CONTEXT_ROOTS = ["host", "account", "params"] as const
export const CAM_CONTEXT_KEYS: ReadonlySet<string> = new Set(CAM_CONTEXT_ROOTS)
