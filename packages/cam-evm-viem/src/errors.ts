export type CamEvmErrorCode =
  | "CAM_HOST_READ_FAILED"
  | "CAM_RESOURCE_LOAD_FAILED"
  | "CAM_HASH_MISMATCH"
  | "CAM_ABI_INVALID"
  | "CAM_CONTRACT_UNBOUND"
  | "CAM_UNKNOWN_CONTRACT"
  | "CAM_ROUTE_CALL_FAILED"
  | "CAM_ROUTE_INVALID_RESULT"

export class CamEvmError extends Error {
  readonly code: CamEvmErrorCode
  readonly cause: unknown

  constructor(code: CamEvmErrorCode, message: string, cause?: unknown) {
    super(message)
    this.name = "CamEvmError"
    this.code = code
    this.cause = cause
  }
}
