export type CamViewerErrorCode =
  | "CAM_VIEWER_NOT_LOADED"
  | "CAM_VIEWER_SCREEN_LOAD_FAILED"
  | "CAM_VIEWER_SCREEN_PARSE_FAILED"
  | "CAM_VIEWER_ACTION_UNSUPPORTED"
  | "CAM_VIEWER_INVALID_INERT_VALUE"
  | "CAM_VIEWER_UNKNOWN_FORM_FIELD"

export class CamViewerError extends Error {
  readonly code: CamViewerErrorCode
  readonly cause: unknown

  constructor(code: CamViewerErrorCode, message: string, cause?: unknown) {
    super(message)
    this.name = "CamViewerError"
    this.code = code
    this.cause = cause
  }
}
