import assert from "node:assert/strict"
import test from "node:test"
import { contractDeploymentReference } from "./reference.ts"
import { parseContractReleasePlan } from "./shared.ts"

const creator = `0x${"11".repeat(20)}`
const admin = `0x${"22".repeat(20)}`
const identity = { schema: "cam.contract-release-plan.v1", sourceCommit: "a".repeat(40), expectedChainId: 31338 }
const settings = {
  tokenName: "Fixture components", tokenSymbol: "FIX", baseTokenURI: "", collectionURI: "Fixture collection",
  intendedComponentsAdmin: admin, componentsAdminDelay: 1, componentsPauser: creator, componentsConfigurer: admin,
  intendedManagerAdmin: admin, managerAdminDelay: 1, managerPauser: creator, managerConfigurer: admin, registrars: [admin],
}
const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value))

test("business deployment plans and approvals require only business settings and complete their own nominations", () => {
  for (const app of ["escrow", "pay-to-play", "bike-nft"] as const) {
    const selected = { ...identity, app, settings: app === "escrow" ? {} : app === "pay-to-play"
      ? { intendedPaymentAdmin: admin, nullClaimPeriod: 86400 } : settings }
    const plan = parseContractReleasePlan(bytes(selected))
    const reference = contractDeploymentReference(plan, creator)
    assert.equal(reference.expectedDeployer, creator)
    assert.equal(reference.sourceCommit, identity.sourceCommit)
    assert.equal(reference.expectedChainId, identity.expectedChainId)
    assert.ok(reference.steps.every(step => step.role !== "camRoot" && step.role !== "ui"))
    assert.deepEqual(reference.steps.filter(step => step.kind === "create").map(step => step.role),
      app === "escrow" ? ["escrow"] : app === "pay-to-play" ? ["payments"] : ["components", "manager"])
    if (app !== "escrow") {
      const last = reference.steps.at(-1)!
      assert.equal(last.name, app === "pay-to-play" ? "transferOwnership" : "beginDefaultAdminTransfer")
      assert.deepEqual(last.args, [admin])
    }
    assert.throws(() => parseContractReleasePlan(bytes({ ...selected, camURI: "https://example.test/cam.json" })), /fields/i)
    assert.throws(() => parseContractReleasePlan(bytes({ ...selected, settings: { ...selected.settings, intendedCamRootOwner: admin } })), /fields/i)
  }
})

test("business settings retain their app-owned publication policy before native narrowing or broadcast", () => {
  assert.throws(() => parseContractReleasePlan(bytes({ ...identity, app: "bike-nft", settings: { ...settings, registrars: [admin, admin] } })), /distinct|duplicate/i)
  assert.throws(() => parseContractReleasePlan(bytes({ ...identity, app: "bike-nft", settings: { ...settings, componentsAdminDelay: 0 } })), /delay/i)
  assert.throws(() => parseContractReleasePlan(bytes({ ...identity, app: "pay-to-play", settings: { intendedPaymentAdmin: admin, nullClaimPeriod: 2592001 } })), /claim period/i)
})
