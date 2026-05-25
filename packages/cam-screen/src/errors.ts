export type ScreenErrorCode =
  | "SCREEN_NOT_OBJECT"
  | "SCREEN_INVALID_FIELD"
  | "SCREEN_INVALID_EXPRESSION"
  | "SCREEN_UNRESOLVED_VALUE"

export class ScreenError extends Error {
  readonly code: ScreenErrorCode
  readonly path: string | undefined

  constructor(code: ScreenErrorCode, message: string, path?: string) {
    super(path === undefined ? message : `${path}: ${message}`)
    this.name = "ScreenError"
    this.code = code
    this.path = path
  }
}
