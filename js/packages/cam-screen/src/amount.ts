import { UiError } from "./errors.ts"
import { isRecordObject } from "@cam/protocol"
import { requiredNonEmptyString } from "./guards.ts"
import type { AmountUnit, AmountDraft, AmountPresentation } from "./types.ts"
import { captureNumericText, canonicalUnsignedDigits, MAX_NUMERIC_DIGITS } from "./numeric.ts"

// Active text is bounded in UTF-16 code units. Canonical significant digits plus
// the maximum scale fit either editing direction within that text bound.
// These are resource limits, independent of ABI ranges or business minima.
const MAX_AMOUNT_DECIMALS = 255

export function parseAmountUnit(value: unknown, path: string): AmountUnit {
  if (!isRecordObject(value) || Object.keys(value).some((key) => !["assetId", "baseLabel", "displayLabel", "decimals"].includes(key))) {
    throw new UiError("UI_INVALID_FIELD", "Amount unit must declare assetId, baseLabel, displayLabel and decimals", path)
  }
  for (const key of ["assetId", "baseLabel", "displayLabel", "decimals"]) {
    if (!Object.hasOwn(value, key)) throw new UiError("UI_INVALID_FIELD", `Amount unit must declare its own ${key}`, `${path}.${key}`)
  }
  // Snapshot each scalar before validation. Public parsing also accepts plain
  // objects with accessors, so returning a later read would bypass the bound.
  const assetId = requiredNonEmptyString(value.assetId, `${path}.assetId`)
  const baseLabel = requiredNonEmptyString(value.baseLabel, `${path}.baseLabel`)
  const displayLabel = requiredNonEmptyString(value.displayLabel, `${path}.displayLabel`)
  const decimals = value.decimals
  if (typeof decimals !== "number" || !Number.isInteger(decimals) || decimals < 0 || decimals > MAX_AMOUNT_DECIMALS) {
    throw new UiError("UI_INVALID_FIELD", `Amount decimals must be an integer from 0 to ${MAX_AMOUNT_DECIMALS}`, `${path}.decimals`)
  }
  return { assetId, baseLabel, displayLabel, decimals }
}

export function sameAmountUnit(left: AmountUnit, right: AmountUnit): boolean {
  return left.assetId === right.assetId && left.baseLabel === right.baseLabel && left.displayLabel === right.displayLabel && left.decimals === right.decimals
}

export function editAmountDraft(unit: AmountUnit, representation: "base" | "display", text: string, composing?: boolean): AmountDraft {
  return { kind: "amount", unit, representation, ...captureNumericText(text, composing) }
}

export function projectAmountDraft(source: AmountDraft): { canonical: string | null; draft: AmountPresentation } {
  const { representation, text, unit } = source
  const active = representation === "base" ? { baseText: text, displayText: "" } : { baseText: "", displayText: text }
  const phase = source.composing ? { composing: true as const } : {}
  const unavailable = (status: "empty" | "incomplete" | "invalid", issue?: AmountPresentation["issue"]) => ({
    canonical: null,
    draft: { representation, ...active, ...phase, status, ...(issue === undefined ? {} : { issue }) },
  })
  if (source.rejection !== null) return unavailable("invalid", source.rejection)
  if (source.composing) return unavailable("incomplete")
  if (text === "") return source.requiredError ? unavailable("invalid", "required") : unavailable("empty")
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
  // A validated display such as .000 at scale zero has an empty coefficient;
  // its discarded fractional digits are all zero, so it represents zero exactly.
  const canonical = canonicalUnsignedDigits(digits === "" ? "0" : digits)
  if (canonical === null) return unavailable("invalid", "syntax")
  if (canonical.length > MAX_NUMERIC_DIGITS) return unavailable("invalid", "tooLong")
  const display = formatAmountDisplay(canonical, unit)
  return { canonical, draft: { representation, baseText: representation === "base" ? text : canonical, displayText: representation === "display" ? text : display, status: "valid" } }
}

export function formatAmountDisplay(canonical: string, unit: AmountUnit): string {
  if (unit.decimals === 0) return canonical
  const padded = canonical.padStart(unit.decimals + 1, "0")
  const fraction = padded.slice(-unit.decimals).replace(/0+$/u, "")
  return padded.slice(0, -unit.decimals) + (fraction === "" ? "" : `.${fraction}`)
}
