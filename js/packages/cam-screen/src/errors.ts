export type UiErrorCode =
  | "UI_NOT_OBJECT"
  | "UI_INVALID_FIELD"
  | "UI_INVALID_EXPRESSION"
  | "UI_UNRESOLVED_VALUE"

export class UiError extends Error {
  readonly code: UiErrorCode
  readonly path: string | undefined

  constructor(code: UiErrorCode, message: string, path?: string) {
    super(path === undefined ? message : `${path}: ${message}`)
    this.name = "UiError"
    this.code = code
    this.path = path
  }
}
