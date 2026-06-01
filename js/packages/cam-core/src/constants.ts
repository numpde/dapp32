export const CAM_VERSION = "1.0.0"

export {
  CAM_CONTRACT_NAMESPACE_PREFIX,
  CAM_ROUTES_NAMESPACE,
  CAM_UI_NAMESPACE,
} from "@cam/protocol"

export const CAM_CONTEXT_KEYS: ReadonlySet<string> = new Set(["host", "account", "inputs", "outputs", "form"])
