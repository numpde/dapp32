import type { DurationDraft, DurationPart, DurationPresentation } from "./types.ts"
import { captureNumericText, canonicalUnsignedDigits, MAX_NUMERIC_DIGITS, projectIntegerDraft } from "./numeric.ts"

export const DURATION_PARTS = ["days", "hours", "minutes", "seconds"] as const
export const SECONDS_PER_PART = { days: 86400n, hours: 3600n, minutes: 60n, seconds: 1n } as const

export function durationDraftFromSeconds(text: string): DurationDraft {
  const source = captureNumericText(text)
  const canonical = canonicalUnsignedDigits(source.text)
  const parts = { days: captureNumericText(""), hours: captureNumericText(""), minutes: captureNumericText(""), seconds: source }
  if (source.rejection === null && canonical !== null && canonical.length <= MAX_NUMERIC_DIGITS) {
    let remainder = BigInt(canonical)
    for (const part of DURATION_PARTS) {
      parts[part] = captureNumericText((remainder / SECONDS_PER_PART[part]).toString())
      remainder %= SECONDS_PER_PART[part]
    }
  }
  return { kind: "duration", parts }
}

export function editDurationDraft(draft: DurationDraft, part: DurationPart, text: string, composing?: boolean): DurationDraft {
  return { kind: "duration", parts: { ...draft.parts, [part]: captureNumericText(text, composing) } }
}

export function projectDurationDraft(source: DurationDraft, bounds: { readonly min?: string; readonly max?: string }): { canonical: string | null; draft: DurationPresentation } {
  const parts = {
    days: projectIntegerDraft({ kind: "integer", ...source.parts.days }, {}).draft,
    hours: projectIntegerDraft({ kind: "integer", ...source.parts.hours }, {}).draft,
    minutes: projectIntegerDraft({ kind: "integer", ...source.parts.minutes }, {}).draft,
    seconds: projectIntegerDraft({ kind: "integer", ...source.parts.seconds }, {}).draft,
  }
  if (DURATION_PARTS.some(part => parts[part].status === "invalid")) return { canonical: null, draft: { parts, status: "invalid" } }
  if (DURATION_PARTS.some(part => parts[part].status === "incomplete")) return { canonical: null, draft: { parts, status: "incomplete" } }
  if (DURATION_PARTS.every(part => parts[part].status === "empty")) return { canonical: null, draft: { parts, status: "empty" } }
  const total = DURATION_PARTS.reduce((sum, part) => sum + BigInt(source.parts[part].text === "" ? "0" : source.parts[part].text) * SECONDS_PER_PART[part], 0n)
  const projection = projectIntegerDraft({ kind: "integer", ...captureNumericText(total.toString()) }, bounds)
  return { canonical: projection.canonical, draft: { parts, status: projection.draft.status, ...(projection.draft.issue === undefined ? {} : { issue: projection.draft.issue }) } }
}
