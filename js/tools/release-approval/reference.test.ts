import assert from "node:assert/strict"
import test from "node:test"
import { keccak256, stringToHex } from "viem"
import type { ReleaseReference } from "./reference.ts"

import { escrowReference } from "../escrow-release/reference.ts"
import { bikeReference } from "../bike-nft-release/reference.ts"
import { payToPlayReference } from "../pay-to-play-release/reference.ts"

const deployer = "0x0000000000000000000000000000000000000011" as const
const owner = "0x0000000000000000000000000000000000000022" as const
const other = "0x0000000000000000000000000000000000000033" as const
const sourceCommit = "0123456789abcdef0123456789abcdef01234567"
const camHash = `0x${"ab".repeat(32)}`
const zeroCamHash = `0x${"00".repeat(32)}`
const common = {
  sourceCommit, expectedChainId: 8453,
  camURI: "https://example.test/cam/main.json", camHash,
  intendedCamRootOwner: owner,
}
const parse = (value: unknown) => new TextEncoder().encode(JSON.stringify(value))

function assertPresentation(reference: ReleaseReference): void {
  for (const step of reference.steps) {
    assert.ok("action" in step && typeof step.action === "string" && step.action.length > 0)
    assert.ok("argumentLabels" in step && Array.isArray(step.argumentLabels))
    assert.equal(step.argumentLabels.length, step.args.length)
    assert.ok(step.argumentLabels.every(label => typeof label === "string" && label.length > 0))
  }
}

test("Escrow reference follows creation, binding and conditional ownership order", () => {
  const normal = escrowReference(parse({ schema: "escrow.release-plan.v2", ...common }), deployer)
  assertPresentation(normal)
  assert.deepEqual(normal.steps.map((step) => `${step.kind}:${step.role}:${step.name}`), [
    "create:camRoot:CamRoot", "create:escrow:CamEscrow", "create:ui:CamEscrowUI",
    "call:camRoot:setContractAddress", "call:camRoot:setContractAddress", "call:camRoot:transferOwnership",
  ])
  assert.deepEqual(normal.steps[2]?.args, [{ createdContract: "escrow" }])
  assert.deepEqual(normal.steps[3]?.args, ["CamEscrowUI", { createdContract: "ui" }])
  assert.deepEqual(normal.steps[4]?.args, ["CamEscrow", { createdContract: "escrow" }])
  assert.equal(escrowReference(parse({ schema: "escrow.release-plan.v2", ...common, intendedCamRootOwner: deployer }), deployer).steps.length, 5)
  const zero = escrowReference(parse({ schema: "escrow.release-plan.v2", ...common, camHash: zeroCamHash }), deployer)
  assert.deepEqual(zero.steps[0]?.args, [deployer, common.camURI, zeroCamHash])
})

test("Pay-to-Play reference covers independent conditional handoffs", () => {
  const plan = { schema: "pay-to-play.release-plan.v1", ...common, intendedPaymentAdmin: other, nullClaimPeriod: 3600 }
  const normal = payToPlayReference(parse(plan), deployer)
  assertPresentation(normal)
  assert.deepEqual(normal.steps.map((step) => `${step.kind}:${step.role}:${step.name}`), [
    "create:camRoot:CamRoot", "create:payments:PayToPlay",
    "call:camRoot:setContractAddress", "call:camRoot:transferOwnership",
    "call:payments:transferOwnership",
  ])
  assert.deepEqual(normal.steps[1]?.args, [deployer, "3600"])
  assert.deepEqual(normal.steps[2]?.args, ["PayToPlay", { createdContract: "payments" }])
  const noRootHandoff = payToPlayReference(parse({ ...plan, intendedCamRootOwner: deployer }), deployer)
  assert.deepEqual(noRootHandoff.steps.filter((step) => step.name === "transferOwnership").map((step) => step.role), ["payments"])
  const noPaymentHandoff = payToPlayReference(parse({ ...plan, intendedPaymentAdmin: deployer }), deployer)
  assert.deepEqual(noPaymentHandoff.steps.filter((step) => step.name === "transferOwnership").map((step) => step.role), ["camRoot"])
  const zero = payToPlayReference(parse({ ...plan, camHash: zeroCamHash }), deployer)
  assert.deepEqual(zero.steps[0]?.args, [deployer, common.camURI, zeroCamHash])
})

test("Bike reference includes every registrar and ordered authority handoff", () => {
  const plan = {
    schema: "bike-nft.release-plan.v2", ...common,
    tokenName: "Bikes", tokenSymbol: "BIKE", baseTokenURI: "https://example.test/b/", collectionURI: "https://example.test/c",
    intendedComponentsAdmin: owner, componentsAdminDelay: 86400, componentsPauser: other, componentsConfigurer: owner,
    intendedManagerAdmin: owner, managerAdminDelay: 172800, managerPauser: other, managerConfigurer: owner,
    registrars: [other, owner],
  }
  const reference = bikeReference(parse(plan), deployer)
  assertPresentation(reference)
  const configuration = reference.steps.find(step => step.role === "manager" && step.name === "grantRole"
    && step.args[0] === keccak256(stringToHex("CONFIGURER_ROLE")))
  assert.ok(configuration && "action" in configuration && "argumentLabels" in configuration)
  assert.match(String(configuration.action), /component collection.*delegation/i)
  assert.match(String(configuration.argumentLabels), /CONFIGURER_ROLE/)
  assert.deepEqual(reference.steps.slice(0, 4).map((step) => step.name), ["CamRoot", "BicycleComponents", "BicycleComponentManager", "BicycleComponentManagerUI"])
  assert.deepEqual(reference.steps[2]?.args, [deployer, "172800", { createdContract: "components" }])
  assert.deepEqual(reference.steps[3]?.args, [{ createdContract: "manager" }])
  assert.deepEqual(reference.steps.map((step) => step.name).slice(-6), [
    "setContractAddress", "setContractAddress", "setContractAddress", "transferOwnership", "beginDefaultAdminTransfer", "beginDefaultAdminTransfer",
  ])
  assert.deepEqual(reference.steps.filter(step => step.name === "setContractAddress").map(step => step.args), [
    ["BicycleComponentManager", { createdContract: "manager" }],
    ["BicycleComponentManagerUI", { createdContract: "ui" }],
    ["BicycleComponents", { createdContract: "components" }],
  ])
  assert.equal(reference.steps.filter((step) => step.name === "grantRole").length, 6 + plan.registrars.length)
  assert.equal(reference.steps.filter((step) => step.name === "revokeRole").length, 4)
  const registrarGrants = reference.steps.filter((step) => step.name === "grantRole" && step.args[1] === other)
  assert.ok(registrarGrants.length >= 1)
  const zero = bikeReference(parse({ ...plan, camHash: zeroCamHash }), deployer)
  assert.deepEqual(zero.steps[0]?.args, [deployer, common.camURI, zeroCamHash])
  const retained = bikeReference(parse({ ...plan, intendedCamRootOwner: deployer, intendedComponentsAdmin: deployer,
    intendedManagerAdmin: deployer, componentsPauser: deployer, componentsConfigurer: deployer,
    managerPauser: deployer, managerConfigurer: deployer, registrars: [deployer, other] }), deployer)
  assert.equal(retained.steps.filter(step => step.name === "revokeRole" || step.name === "transferOwnership" || step.name === "beginDefaultAdminTransfer").length, 0)
  const mixed = bikeReference(parse({ ...plan, intendedCamRootOwner: deployer, intendedComponentsAdmin: deployer,
    componentsPauser: deployer, managerConfigurer: deployer, registrars: [deployer, other] }), deployer)
  assert.deepEqual(mixed.steps.filter(step => step.name === "revokeRole").map(step => step.role), ["components", "manager"])
  assert.deepEqual(mixed.steps.filter(step => step.name === "transferOwnership" || step.name === "beginDefaultAdminTransfer").map(step => step.role), ["manager"])
})

test("references reject invalid plans and invalid independent sender", () => {
  assert.throws(() => escrowReference(parse({ schema: "escrow.release-plan.v2", ...common, expectedChainId: 31337 }), deployer), /fixture chain/)
  assert.throws(() => payToPlayReference(parse({ schema: "pay-to-play.release-plan.v1", ...common, intendedPaymentAdmin: owner, nullClaimPeriod: -1 }), deployer), /claim period/)
  assert.throws(() => escrowReference(parse({ schema: "escrow.release-plan.v2", ...common }), "0x0000000000000000000000000000000000000000"), /zero address/)
})
