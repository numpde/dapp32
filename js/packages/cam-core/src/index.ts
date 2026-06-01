export type {
  CamDocument,
  CamInvocation,
  CamNamespace,
  CamResolvedInvocation,
  CamRoute,
  CamRuntimeContext,
} from "./types.ts"
export type {
  InertRecord,
  InertValue,
} from "@cam/protocol"

export {
  CAM_CONTRACT_NAMESPACE_PREFIX,
  CAM_ROUTES_NAMESPACE,
  CAM_UI_NAMESPACE,
} from "./constants.ts"

export { CamError } from "./errors.ts"
export type { CamErrorCode } from "./errors.ts"

export { parseCam } from "./validate.ts"

export { createContext } from "./context.ts"

export {
  resolveRouteCall,
  resolveRouteThen,
} from "./routes.ts"

export { resolveResourceURI } from "./uri.ts"
