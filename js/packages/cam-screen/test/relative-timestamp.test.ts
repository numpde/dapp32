import assert from "node:assert/strict"
import test from "node:test"

import { formatRelativeTimestamp } from "../src/index.ts"

test("relative timestamps use an explicit clock and exact whole-second differences", () => {
  for (const [value, now, expected] of [
    ["100", 100, "Now"],
    ["101", 100, "In 1 second"],
    ["99", 100, "1 second ago"],
    ["165", 100, "In 1 minute, 5 seconds"],
    ["0", 90061, "1 day, 1 hour, 1 minute, 1 second ago"],
    ["9007199254740993", 1, "In 104,249,991,374 days, 7 hours, 36 minutes, 32 seconds"],
  ] as const) assert.equal(formatRelativeTimestamp(value, now, "Status.props"), expected)
})

test("relative presentation never turns app-declared absence into an epoch or a time difference", () => {
  for (const zero of [0, "0", "000"]) assert.equal(formatRelativeTimestamp(zero, 100, "Status.props", "No active request"), undefined)
  assert.equal(formatRelativeTimestamp("1", 100, "Status.props", "No active request"), "1 minute, 39 seconds ago")
  assert.equal(formatRelativeTimestamp("0", 0, "Status.props"), "Now")
})

test("relative timestamps retain the shared timestamp operand and absence validation", () => {
  for (const value of ["", "-1", "1.5", "1e3", true, null, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => formatRelativeTimestamp(value, 100, "Status.props"), /non-negative.*integer/)
  }
  for (const zeroText of ["", "   ", 0, false]) {
    assert.throws(() => formatRelativeTimestamp("1", 100, "Status.props", zeroText), /zeroText/)
  }
})
