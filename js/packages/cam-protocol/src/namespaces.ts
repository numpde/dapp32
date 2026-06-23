import type {
  CamNamespaceType,
} from "./manifest.ts"

export const CAM_CONTRACT_NAMESPACE_PREFIX = "contracts."
export const CAM_ROUTES_NAMESPACE = "routes"
export const CAM_UI_NAMESPACE = "ui"

const CAM_CONTRACT_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/

export function isCamNamespaceNameForType(name: string, type: CamNamespaceType): boolean {
  switch (type) {
    case "contract":
      // The suffix is passed to CamRoot.contractAddress(string) as the bare
      // onchain contract key; keep it one reviewable identifier, not an
      // arbitrary nested namespace or punctuation-bearing label.
      if (!name.startsWith(CAM_CONTRACT_NAMESPACE_PREFIX)) return false
      return CAM_CONTRACT_NAME_RE.test(name.slice(CAM_CONTRACT_NAMESPACE_PREFIX.length))
    case "routes":
      return name === CAM_ROUTES_NAMESPACE
    case "ui":
      return name === CAM_UI_NAMESPACE
  }
}
