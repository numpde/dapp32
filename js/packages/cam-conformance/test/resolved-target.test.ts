import assert from "node:assert/strict"
import test from "node:test"
import { validateCamBundle } from "../src/index.ts"
import { resolvedTargetBundle, resolvedTargetManagerAbi, makeStaticResolvedTargetDocument } from "../../../../tests/fixtures/cam/bike-resolved-target.mts"

test("CAM 1.3 bounded target publication is valid with a scalar address and uint256 read result", () => {
  assert.deepEqual(validateCamBundle(resolvedTargetBundle()), [])
})

for (const type of ["string", "bytes20", "uint160", "address[]", "tuple"]) {
  test(`resolved target rejects ABI ${type}, not merely an unsupported CAM version`, () => {
    const resolver = { ...resolvedTargetManagerAbi[1], outputs: [
      { name: "token", type, ...(type === "tuple" ? { components: [{ name: "address", type: "address" }] } : {}) },
      { name: "tokenId", type: "uint256" },
    ] }
    const issues = validateCamBundle(resolvedTargetBundle(undefined, [resolvedTargetManagerAbi[0], resolver]))
    assert.ok(issues.length > 0)
    assert.ok(!issues.some(issue => issue.rule === "CAM_MANIFEST_VERSION_INVALID"), "successor must reach ABI validation")
    assert.ok(issues.some(issue => issue.path?.startsWith("routes.transferComponent") && /address|target/i.test(issue.message)), JSON.stringify(issues))
  })
}

for (const stateMutability of ["nonpayable", "payable"]) {
  test(`bounded resolver cannot invoke a ${stateMutability} ABI function`, () => {
    const issues = validateCamBundle(resolvedTargetBundle(undefined, [resolvedTargetManagerAbi[0], { ...resolvedTargetManagerAbi[1], stateMutability }]))
    assert.ok(!issues.some(issue => issue.rule === "CAM_MANIFEST_VERSION_INVALID"))
    assert.ok(issues.some(issue => issue.path?.startsWith("routes.transferComponent.resolve") && /read|view|pure|mutability/i.test(issue.message)), JSON.stringify(issues))
  })
}

test("resolved token ID must be ABI-compatible with the final write input", () => {
  const issues = validateCamBundle(resolvedTargetBundle(undefined, [resolvedTargetManagerAbi[0], {
    ...resolvedTargetManagerAbi[1], outputs: [{ name: "token", type: "address" }, { name: "tokenId", type: "string" }],
  }]))
  assert.ok(!issues.some(issue => issue.rule === "CAM_MANIFEST_VERSION_INVALID"))
  assert.ok(issues.some(issue => issue.path?.startsWith("routes.transferComponent.call.args.tokenId")), JSON.stringify(issues))
})

test("CAM 1.2 positive control validates the same resource and overloaded ABI harness", () => {
  assert.deepEqual(validateCamBundle(resolvedTargetBundle(makeStaticResolvedTargetDocument)), [])
})

test("bounded resolver accepts a pure ABI read as well as view", () => {
  assert.deepEqual(validateCamBundle(resolvedTargetBundle(undefined, [resolvedTargetManagerAbi[0], {
    ...resolvedTargetManagerAbi[1], stateMutability: "pure",
  }])), [])
})
