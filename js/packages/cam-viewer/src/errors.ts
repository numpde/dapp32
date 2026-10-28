import type { CamViewerLoadedSnapshot } from "./types.ts"

export type CamViewerErrorCode =
  | "CAM_VIEWER_NOT_LOADED"
  | "CAM_VIEWER_UI_LOAD_FAILED"
  | "CAM_VIEWER_UI_PARSE_FAILED"
  | "CAM_VIEWER_ACTION_UNSUPPORTED"
  | "CAM_VIEWER_INVALID_INERT_VALUE"

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

export class CamViewerInputError extends CamViewerError {
  declare readonly snapshot: CamViewerLoadedSnapshot

  constructor(message: string, snapshot: CamViewerLoadedSnapshot) {
    super("CAM_VIEWER_INVALID_INERT_VALUE", message)
    this.name = "CamViewerInputError"
    // Form contents belong to the UI handler, not ordinary exception logging.
    Object.defineProperty(this, "snapshot", { value: snapshot })
  }
}
