import assert from "node:assert/strict"
import test from "node:test"

import { durationDraftFromSeconds, editDurationDraft, projectDurationDraft } from "../src/duration.ts"
import { MAX_NUMERIC_DIGITS, MAX_NUMERIC_TEXT_LENGTH } from "../src/numeric.ts"

test("duration parts add exact whole seconds without normalizing entered parts", () => {
  let draft = durationDraftFromSeconds("")
  for (const [part, text] of [["days", "0002"], ["hours", "25"], ["minutes", "61"], ["seconds", "90"]] as const) {
    draft = editDurationDraft(draft, part, text)
  }
  const result = projectDurationDraft(draft, {})
  assert.equal(result.canonical, "266550")
  assert.deepEqual(Object.fromEntries(Object.entries(result.draft.parts).map(([part, value]) => [part, value.text])), {
    days: "0002", hours: "25", minutes: "61", seconds: "90",
  })
  assert.equal(projectDurationDraft(durationDraftFromSeconds("9007199254740993"), {}).canonical, "9007199254740993")
})

test("duration blank parts are zero only when another part is entered", () => {
  const empty = durationDraftFromSeconds("")
  assert.equal(projectDurationDraft(empty, {}).canonical, null)
  const zero = editDurationDraft(empty, "minutes", "0")
  assert.equal(projectDurationDraft(zero, {}).canonical, "0")
  assert.equal(projectDurationDraft(editDurationDraft(empty, "hours", "2"), {}).canonical, "7200")
  assert.equal(projectDurationDraft(durationDraftFromSeconds("90061"), {}).canonical, "90061")
})

test("duration rejects incomplete, fractional, oversized and malformed parts without hiding the draft", () => {
  const initial = durationDraftFromSeconds("60")
  for (const text of ["1.5", "-1", "+1", "1e3", " 1", "1,000", "١"]) {
    const result = projectDurationDraft(editDurationDraft(initial, "days", text), {})
    assert.equal(result.canonical, null)
    assert.equal(result.draft.parts.days.text, text)
  }
  assert.equal(projectDurationDraft(editDurationDraft(initial, "days", "1", true), {}).canonical, null)
  for (const text of ["x".repeat(MAX_NUMERIC_TEXT_LENGTH + 1), "1\n2"]) {
    const result = projectDurationDraft(editDurationDraft(initial, "hours", text), {})
    assert.equal(result.canonical, null)
    assert.equal(result.draft.parts.hours.text, "")
  }
  const large = editDurationDraft(initial, "days", "9".repeat(MAX_NUMERIC_DIGITS))
  assert.equal(projectDurationDraft(large, {}).canonical, null)
})

test("duration bounds apply to the sum in seconds and can be refreshed independently of drafts", () => {
  const draft = editDurationDraft(durationDraftFromSeconds(""), "minutes", "2")
  assert.equal(projectDurationDraft(draft, { min: "120", max: "120" }).canonical, "120")
  assert.equal(projectDurationDraft(draft, { min: "121" }).canonical, null)
  assert.equal(projectDurationDraft(draft, { max: "119" }).canonical, null)
  assert.equal(projectDurationDraft(draft, { max: "120" }).canonical, "120")
  assert.equal(draft.parts.minutes.text, "2")
})
