import assert from "node:assert/strict"
import test from "node:test"

import {
  conformanceRules,
  issueFromError,
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

test("issueFromError preserves readable error paths", () => {
  const error = new Error("bad route") as Error & { path: string }
  error.path = "routes.entry"

  assert.deepEqual(issueFromError({
    rule: "CAM_TEST_FAILURE",
    resource: "cam.json",
    error,
  }), {
    rule: "CAM_TEST_FAILURE",
    severity: "error",
    resource: "cam.json",
    path: "routes.entry",
    message: "bad route",
  })
})

test("issueFromError survives hostile error path and stringification", () => {
  const hostile = new Proxy({
    toString() {
      throw new Error("hostile toString")
    },
  }, {
    has() {
      throw new Error("hostile has")
    },
  })

  assert.deepEqual(issueFromError({
    rule: "CAM_TEST_FAILURE",
    resource: "cam.json",
    error: hostile,
  }), {
    rule: "CAM_TEST_FAILURE",
    severity: "error",
    resource: "cam.json",
    message: "unprintable error",
  })
})
