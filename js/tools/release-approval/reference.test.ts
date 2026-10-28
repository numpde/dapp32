import assert from "node:assert/strict"
import test from "node:test"
import { keccak256, stringToHex } from "viem"
import type { ReleaseReference } from "./reference.ts"
import { releaseReferenceFromPlan } from "./reference-snapshot.ts"

const deployer = "0x0000000000000000000000000000000000000011" as const
const owner = "0x0000000000000000000000000000000000000022" as const
const other = "0x0000000000000000000000000000000000000033" as const
const sourceCommit = "0123456789abcdef0123456789abcdef01234567"
const parse = (value: unknown) => new TextEncoder().encode(JSON.stringify(value))

function assertPresentation(reference: ReleaseReference): void {
  for (const step of reference.steps) {
    assert.ok(typeof step.action === "string" && step.action.length > 0)
    assert.equal(step.argumentLabels.length, step.args.length)
    assert.ok(step.argumentLabels.every(label => typeof label === "string" && label.length > 0))
  }
}

test("Escrow business reference contains only its contract creation", () => {
  const plan = { schema: "cam.contract-release-plan.v1", app: "escrow", sourceCommit, expectedChainId: 8453, settings: {} }
  const reference = releaseReferenceFromPlan("escrow", parse(plan), deployer)
  assertPresentation(reference)
  assert.deepEqual(reference.steps.map(step => `${step.kind}:${step.role}:${step.name}`), ["create:escrow:CamEscrow"])
  assert.deepEqual(reference.steps[0]?.args, [])
})

test("Pay-to-Play business reference owns its constructor and conditional payment admin handoff", () => {
  const plan = { schema: "cam.contract-release-plan.v1", app: "pay-to-play", sourceCommit, expectedChainId: 8453,
    settings: { intendedPaymentAdmin: other, nullClaimPeriod: 3600 } }
  const reference = releaseReferenceFromPlan("pay-to-play", parse(plan), deployer)
  assertPresentation(reference)
  assert.deepEqual(reference.steps.map(step => `${step.kind}:${step.role}:${step.name}`), [
    "create:payments:PayToPlay", "call:payments:transferOwnership",
  ])
  assert.deepEqual(reference.steps[0]?.args, [deployer, "3600"])
  assert.deepEqual(reference.steps[1]?.args, [other])
  const retained = releaseReferenceFromPlan("pay-to-play", parse({ ...plan,
    settings: { ...plan.settings, intendedPaymentAdmin: deployer } }), deployer)
  assert.equal(retained.steps.length, 1)
})

test("Bike business reference includes every registrar and ordered authority handoff", () => {
  const plan = {
    schema: "cam.contract-release-plan.v1", app: "bike-nft", sourceCommit, expectedChainId: 8453,
    settings: {
      tokenName: "Bikes", tokenSymbol: "BIKE", baseTokenURI: "https://example.test/b/", collectionURI: "https://example.test/c",
      intendedComponentsAdmin: owner, componentsAdminDelay: 86400, componentsPauser: other, componentsConfigurer: owner,
      intendedManagerAdmin: owner, managerAdminDelay: 172800, managerPauser: other, managerConfigurer: owner,
      registrars: [other, owner],
    },
  }
  const reference = releaseReferenceFromPlan("bike-nft", parse(plan), deployer)
  assertPresentation(reference)
  const configuration = reference.steps.find(step => step.role === "manager" && step.name === "grantRole"
    && step.args[0] === keccak256(stringToHex("CONFIGURER_ROLE")))
  assert.ok(configuration)
  assert.match(configuration.action, /component collection.*delegation/i)
  assert.match(String(configuration.argumentLabels), /CONFIGURER_ROLE/)
  assert.deepEqual(reference.steps.slice(0, 2).map(step => step.name), ["BicycleComponents", "BicycleComponentManager"])
  assert.deepEqual(reference.steps[1]?.args, [deployer, "172800", { createdContract: "components" }])
  assert.ok(reference.steps.every(step => step.role !== "camRoot" && step.role !== "ui"))
  assert.deepEqual(reference.steps.slice(-2).map(step => step.name), ["beginDefaultAdminTransfer", "beginDefaultAdminTransfer"])
  assert.equal(reference.steps.filter(step => step.name === "grantRole").length, 6 + plan.settings.registrars.length)
  assert.equal(reference.steps.filter(step => step.name === "revokeRole").length, 4)
  assert.ok(reference.steps.some(step => step.name === "grantRole" && step.args[1] === other))
  const retained = releaseReferenceFromPlan("bike-nft", parse({ ...plan, settings: { ...plan.settings,
    intendedComponentsAdmin: deployer, intendedManagerAdmin: deployer, componentsPauser: deployer, componentsConfigurer: deployer,
    managerPauser: deployer, managerConfigurer: deployer, registrars: [deployer, other] } }), deployer)
  assert.equal(retained.steps.filter(step => step.name === "revokeRole" || step.name === "beginDefaultAdminTransfer").length, 0)
  const mixed = releaseReferenceFromPlan("bike-nft", parse({ ...plan, settings: { ...plan.settings,
    intendedComponentsAdmin: deployer, componentsPauser: deployer, managerConfigurer: deployer, registrars: [deployer, other] } }), deployer)
  assert.deepEqual(mixed.steps.filter(step => step.name === "revokeRole").map(step => step.role), ["components", "manager"])
  assert.deepEqual(mixed.steps.filter(step => step.name === "beginDefaultAdminTransfer").map(step => step.role), ["manager"])
})

test("references reject invalid plans and invalid independent sender", () => {
  const plan = { schema: "cam.contract-release-plan.v1", app: "escrow", sourceCommit, expectedChainId: 8453, settings: {} }
  assert.throws(() => releaseReferenceFromPlan("escrow", parse({ ...plan, expectedChainId: 31337 }), deployer), /fixture chain/)
  assert.throws(() => releaseReferenceFromPlan("pay-to-play", parse({ ...plan, app: "pay-to-play",
    settings: { intendedPaymentAdmin: owner, nullClaimPeriod: -1 } }), deployer), /claim period/)
  assert.throws(() => releaseReferenceFromPlan("escrow", parse(plan), "0x0000000000000000000000000000000000000000"), /zero address/)
})

test("fresh approval rejects a retired combined deployment plan", () => {
  const legacy = { schema: "escrow.release-plan.v2", sourceCommit, expectedChainId: 8453,
    camURI: "https://example.test/cam/main.json", camHash: `0x${"ab".repeat(32)}`, intendedCamRootOwner: owner }
  assert.throws(() => releaseReferenceFromPlan("escrow", parse(legacy), deployer), /independent business or UI release plan/)
})
