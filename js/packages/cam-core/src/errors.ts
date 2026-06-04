export type CamErrorCode =
  | "CAM_NOT_OBJECT"
  | "CAM_INVALID_FIELD"
  | "CAM_UNKNOWN_FIELD"
  | "CAM_ENTRY_ROUTE_MISSING"
  | "CAM_UNKNOWN_CONTRACT"
  | "CAM_INVALID_EXPRESSION"
  | "CAM_UNRESOLVED_VALUE"
  | "CAM_INVALID_URI"

export class CamError extends Error {
  readonly code: CamErrorCode
  readonly path: string | undefined

  constructor(code: CamErrorCode, message: string, path?: string) {
    super(path === undefined ? message : `${path}: ${message}`)
    this.name = "CamError"
    this.code = code
    this.path = path
  }
}
