import { UiError } from "./errors.ts"
import { isRecordObject } from "@cam/protocol"
import { requiredNonEmptyString } from "./guards.ts"
import type { AmountUnit, AmountDraft, AmountPresentation } from "./types.ts"

// Active text is bounded in UTF-16 code units. Canonical significant digits plus
// the maximum scale fit either editing direction within that text bound.
// These are resource limits, independent of ABI ranges or business minima.
export const MAX_AMOUNT_TEXT_LENGTH = 2048
export const MAX_AMOUNT_DIGITS = 1024
const MAX_AMOUNT_DECIMALS = 255

export function parseAmountUnit(value: unknown, path: string): AmountUnit {
  if (!isRecordObject(value) || Object.keys(value).some((key) => !["assetId", "baseLabel", "displayLabel", "decimals"].includes(key))) {
    throw new UiError("UI_INVALID_FIELD", "AmountField unit must declare assetId, baseLabel, displayLabel and decimals", path)
  }
  for (const key of ["assetId", "baseLabel", "displayLabel", "decimals"]) {
    if (!Object.hasOwn(value, key)) throw new UiError("UI_INVALID_FIELD", `AmountField unit must declare its own ${key}`, `${path}.${key}`)
  }
  // Snapshot each scalar before validation. Public parsing also accepts plain
  // objects with accessors, so returning a later read would bypass the bound.
  const assetId = requiredNonEmptyString(value.assetId, `${path}.assetId`)
  const baseLabel = requiredNonEmptyString(value.baseLabel, `${path}.baseLabel`)
  const displayLabel = requiredNonEmptyString(value.displayLabel, `${path}.displayLabel`)
  const decimals = value.decimals
  if (typeof decimals !== "number" || !Number.isInteger(decimals) || decimals < 0 || decimals > MAX_AMOUNT_DECIMALS) {
    throw new UiError("UI_INVALID_FIELD", `AmountField decimals must be an integer from 0 to ${MAX_AMOUNT_DECIMALS}`, `${path}.decimals`)
  }
  return { assetId, baseLabel, displayLabel, decimals }
}

export function sameAmountUnit(left: AmountUnit, right: AmountUnit): boolean {
  return left.assetId === right.assetId && left.baseLabel === right.baseLabel && left.displayLabel === right.displayLabel && left.decimals === right.decimals
}

export function editAmountDraft(unit: AmountUnit, representation: "base" | "display", text: string, composing?: boolean): AmountDraft {
  const rejection = text.length > MAX_AMOUNT_TEXT_LENGTH ? "tooLong" : /[\r\n]/u.test(text) ? "lineBreak" : null
  return { unit, representation, text: rejection === null ? text : "", rejection, composing: composing === true }
}

export function projectAmountDraft(source: AmountDraft): { canonical: string | null; draft: AmountPresentation } {
  const { representation, text, unit } = source
  const active = representation === "base" ? { baseText: text, displayText: "" } : { baseText: "", displayText: text }
  const phase = source.composing ? { composing: true as const } : {}
  const unavailable = (status: "empty" | "incomplete" | "invalid", issue?: "syntax" | "precision" | "tooLong" | "lineBreak") => ({
    canonical: null,
    draft: { representation, ...active, ...phase, status, ...(issue === undefined ? {} : { issue }) },
  })
  if (source.rejection !== null) return unavailable("invalid", source.rejection)
  if (source.composing) return unavailable("incomplete")
  if (text === "") return unavailable("empty")
  if (representation === "display" && text === ".") return unavailable("incomplete")
  // Negated character checks enforce the whole string, including final line terminators.
  if (representation === "base" ? /[^0-9]/u.test(text) : /[^0-9.]/u.test(text) || text.split(".").length > 2) return unavailable("invalid", "syntax")
  let digits: string
  if (representation === "base") {
    digits = text
  } else {
    const [whole, fraction = ""] = text.split(".")
    if (/[^0]/u.test(fraction.slice(unit.decimals))) return unavailable("invalid", "precision")
    digits = whole + fraction.slice(0, unit.decimals).padEnd(unit.decimals, "0")
  }
  const significant = digits.replace(/^0+/u, "")
  const canonical = significant === "" ? "0" : significant
  if (canonical.length > MAX_AMOUNT_DIGITS) return unavailable("invalid", "tooLong")
  let display = canonical
  if (unit.decimals > 0) {
    const padded = canonical.padStart(unit.decimals + 1, "0")
    const fraction = padded.slice(-unit.decimals).replace(/0+$/u, "")
    display = padded.slice(0, -unit.decimals) + (fraction === "" ? "" : `.${fraction}`)
  }
  return { canonical, draft: { representation, baseText: representation === "base" ? text : canonical, displayText: representation === "display" ? text : display, status: "valid" } }
}
