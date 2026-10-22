import assert from "node:assert/strict"
import test from "node:test"

import {
  CAM_VERSION,
  collectCamRootFact,
  isCamVersion,
} from "../src/index.ts"

test("owns the current CAM version", () => {
  assert.equal(CAM_VERSION, "1.3.0")

  assert.equal(isCamVersion("1.0.0"), false)
  assert.equal(isCamVersion("1.1.0"), false)
  assert.equal(isCamVersion("1.2.0"), false)
  assert.equal(isCamVersion("1.3.0"), true)
  assert.equal(isCamVersion(null), false)
})

test("collects the current CAM root version exactly", () => {
  const result = collectCamRootFact({
    cam: "1.3.0",
    extra: true,
  }, { resource: "cam" })

  assert.equal(result.value?.version, "1.3.0")
  assert.deepEqual(result.diagnostics, [{
    code: "CAM_FACT_ROOT_FIELD_UNKNOWN",
    resource: "cam",
    path: "extra",
    message: "field is not allowed in CAM 1.3.0: extra",
  }])
})

test("reports unsupported and absent CAM versions without inventing a default", () => {
  assert.deepEqual(collectCamRootFact({ cam: "2.0.0" }, { resource: "cam" }), {
    diagnostics: [{
      code: "CAM_FACT_ROOT_VERSION_INVALID",
      resource: "cam",
      path: "cam",
      message: "unsupported CAM version: 2.0.0",
    }],
  })

  assert.deepEqual(collectCamRootFact({}, { resource: "cam" }), {
    diagnostics: [{
      code: "CAM_FACT_ROOT_VERSION_INVALID",
      resource: "cam",
      path: "cam",
      message: "CAM version must be 1.3.0",
    }],
  })
})

test("rejects retired CAM 1.0, 1.1, and 1.2 roots", () => {
  for (const version of ["1.0.0", "1.1.0", "1.2.0"]) {
    assert.deepEqual(collectCamRootFact({ cam: version }, { resource: "cam" }), {
      diagnostics: [{
        code: "CAM_FACT_ROOT_VERSION_INVALID",
        resource: "cam",
        path: "cam",
        message: `unsupported CAM version: ${version}`,
      }],
    })
  }
})
