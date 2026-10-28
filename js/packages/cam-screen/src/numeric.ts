import { UiError } from "./errors.ts"
import type { IntegerDraft, IntegerPresentation, NumericTextDraft } from "./types.ts"

// Resource bounds, independent of ABI widths or declared business ranges.
export const MAX_NUMERIC_TEXT_LENGTH = 2048
export const MAX_NUMERIC_DIGITS = 1024

export function captureNumericText(text: string, composing?: boolean): NumericTextDraft {
  const rejection = text.length > MAX_NUMERIC_TEXT_LENGTH ? "tooLong" : /[\r\n]/u.test(text) ? "lineBreak" : null
  return { text: rejection === null ? text : "", rejection, composing: composing === true }
}

export function canonicalUnsignedDigits(text: string): string | null {
  if (text === "" || /[^0-9]/u.test(text)) return null
  const significant = text.replace(/^0+/u, "")
  return significant === "" ? "0" : significant
}

export function compareUnsignedDigits(left: string, right: string): number {
  return left.length === right.length ? left === right ? 0 : left < right ? -1 : 1 : left.length < right.length ? -1 : 1
}

export function integerBound(value: unknown, path: string): string {
  const canonical = typeof value === "string" && value.length <= MAX_NUMERIC_TEXT_LENGTH ? canonicalUnsignedDigits(value) : null
  if (canonical === null || canonical.length > MAX_NUMERIC_DIGITS) {
    throw new UiError("UI_INVALID_FIELD", "Integer bound must resolve to a bounded nonnegative decimal integer string", path)
  }
  return canonical
}

export function editIntegerDraft(text: string, composing?: boolean): IntegerDraft {
  return { kind: "integer", ...captureNumericText(text, composing) }
}

export function projectIntegerDraft(source: IntegerDraft, bounds: { readonly min?: string; readonly max?: string }): { canonical: string | null; draft: IntegerPresentation } {
  const unavailable = (status: "empty" | "incomplete" | "invalid", issue?: IntegerPresentation["issue"]) => ({ canonical: null,
    draft: { text: source.text, status, ...(source.composing ? { composing: true as const } : {}), ...(issue === undefined ? {} : { issue }) } })
  if (source.rejection !== null) return unavailable("invalid", source.rejection)
  if (source.composing) return unavailable("incomplete")
  if (source.text === "") return source.requiredError ? unavailable("invalid", "required") : unavailable("empty")
  const canonical = canonicalUnsignedDigits(source.text)
  if (canonical === null) return unavailable("invalid", "syntax")
  if (canonical.length > MAX_NUMERIC_DIGITS) return unavailable("invalid", "tooLong")
  if (bounds.min !== undefined && compareUnsignedDigits(canonical, bounds.min) < 0) return unavailable("invalid", "belowMin")
  if (bounds.max !== undefined && compareUnsignedDigits(canonical, bounds.max) > 0) return unavailable("invalid", "aboveMax")
  return { canonical, draft: { text: source.text, status: "valid" } }
}
