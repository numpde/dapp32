import assert from "node:assert/strict"
import test from "node:test"

import { emptyConformanceReport } from "../src/index.ts"

test("emptyConformanceReport returns a passing report with no issues", () => {
  assert.deepEqual(emptyConformanceReport(), {
    ok: true,
    issues: [],
  })
})
