import assert from "node:assert/strict"
import test from "node:test"

import {
  CAM_SUPPORTED_VERSIONS,
  CAM_VERSION,
  collectCamRootFact,
  isCamVersion,
} from "../src/index.ts"

test("owns the supported CAM version inventory", () => {
  assert.equal(CAM_VERSION, "1.0.0")
  assert.deepEqual([...CAM_SUPPORTED_VERSIONS], ["1.0.0", "1.1.0"])
  assert.equal(Object.isFrozen(CAM_SUPPORTED_VERSIONS), true)

  assert.equal(isCamVersion("1.0.0"), true)
  assert.equal(isCamVersion("1.1.0"), true)
  assert.equal(isCamVersion("1.2.0"), false)
  assert.equal(isCamVersion(null), false)
})

test("collects each supported CAM root version exactly", () => {
  for (const version of CAM_SUPPORTED_VERSIONS) {
    const result = collectCamRootFact({
      cam: version,
      extra: true,
    }, { resource: "cam" })

    assert.equal(result.value?.version, version)
    assert.deepEqual(result.diagnostics, [{
      code: "CAM_FACT_ROOT_FIELD_UNKNOWN",
      resource: "cam",
      path: "extra",
      message: `field is not allowed in CAM ${version}: extra`,
    }])
  }
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
      message: "CAM version must be 1.0.0 or 1.1.0",
    }],
  })
})
