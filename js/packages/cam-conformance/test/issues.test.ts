import assert from "node:assert/strict"
import test from "node:test"

import {
  conformanceRules,
} from "../src/issues.ts"

test("conformance rule descriptors must justify retained ownership", () => {
  assert.throws(
    () => conformanceRules({
      CAM_TEST_RULE: {
        class: "A",
        reason: "",
      },
    }),
    /must justify its ownership: CAM_TEST_RULE/,
  )
})

test("Class C conformance rule descriptors fail at the authoring API", () => {
  assert.throws(
    () => conformanceRules({
      CAM_TEST_RULE: {
        class: "C",
        reason: "Runtime-owned duplicate kept only to exercise descriptor rejection.",
      },
    }),
    /Class C CAM conformance rule must be removed or moved to its runtime owner: CAM_TEST_RULE/,
  )
})

test("Class B conformance rule descriptors must state their limitation", () => {
  assert.deepEqual(
    conformanceRules({
      CAM_TEST_RULE: {
        class: "B",
        reason: "Kept temporarily because the publication boundary is deterministic.",
        limitation: "Needs a narrower Class A formulation before more rules depend on it.",
      },
    }),
    { CAM_TEST_RULE: "CAM_TEST_RULE" },
  )

  assert.throws(
    () => conformanceRules({
      CAM_TEST_RULE: {
        class: "B",
        reason: "Kept temporarily because the publication boundary is deterministic.",
        limitation: "",
      },
    }),
    /Class B CAM conformance rule must document its limitation: CAM_TEST_RULE/,
  )
})
