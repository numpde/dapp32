import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import test from "node:test"
import { rehearsalApp, shellAssignments } from "./fixture.ts"

test("fixture environment publication preserves literal values without shell execution", () => {
  for (const value of ["space separated", "quote'and\\slash", "$(exit 42)", "`exit 42`", "line\nbreak"]) {
    const assignments = shellAssignments({ FIXTURE_VALUE: value })
    const actual = execFileSync("sh", ["-eu", "-c", assignments + 'printf %s "$FIXTURE_VALUE"'], { encoding: "utf8" })
    assert.equal(actual, value)
  }
  assert.throws(() => shellAssignments({ "INVALID;exit": "x" }), /Invalid fixture variable/)
})

test("rehearsal selection refuses unfinished or unknown apps", () => {
  for (const app of ["bike-nft", "escrow", "pay-to-play"]) assert.equal(rehearsalApp(app), app)
  for (const app of ["deposit", "", "../escrow"]) assert.throws(() => rehearsalApp(app), /No release rehearsal/)
})
