import assert from "node:assert/strict"
import test from "node:test"

import {
  conformanceRules,
} from "../src/issues.ts"

test("conformance rule descriptors compile to stable issue codes only", () => {
  assert.deepEqual(
    conformanceRules({
      CAM_RETAINED_RULE: {
        class: "A",
        reason: "Deterministic publication failure from supplied bundle bytes.",
      },
      CAM_TEST_RULE: {
        class: "B",
        reason: "Kept temporarily because the publication boundary is deterministic.",
        limitation: "Needs a narrower Class A formulation before more rules depend on it.",
      },
    }),
    {
      CAM_RETAINED_RULE: "CAM_RETAINED_RULE",
      CAM_TEST_RULE: "CAM_TEST_RULE",
    },
  )
})
