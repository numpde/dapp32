import assert from "node:assert/strict"
import test from "node:test"
import { backingFromDeployment } from "../ui-release/shared.ts"


import { keccak256 } from "viem"
import type { Address, Hex } from "viem"
import { parseReleasePlan, parseDeploymentArtifact, RELEASE_PLAN_SCHEMA, DEPLOYMENT_SCHEMA } from "./shared.ts"
import { creationTransactionInputHash } from "../release-provenance.ts"

const SOURCE = "0123456789abcdef0123456789abcdef01234567"
const ADMIN = "0x0000000000000000000000000000000000000011" as Address
const OWNER = "0x0000000000000000000000000000000000000044" as Address
const ROOT = "0x0000000000000000000000000000000000000022" as Address
const UI = "0x0000000000000000000000000000000000000055" as Address
const TX3 = `0x${"56".repeat(32)}` as Hex
const PAYMENTS = "0x0000000000000000000000000000000000000033" as Address
const HASH = `0x${"ab".repeat(32)}` as Hex
const TX = `0x${"12".repeat(32)}` as Hex
const TX2 = `0x${"34".repeat(32)}` as Hex
const ZERO = "0x0000000000000000000000000000000000000000"
const bytes = (value: unknown): Uint8Array => new TextEncoder().encode(JSON.stringify(value))

function plan() {
  return {
    schema: RELEASE_PLAN_SCHEMA, sourceCommit: SOURCE, expectedChainId: 11155111,
    camURI: "https://example.test/pay-to-play/cam/main.json", camHash: HASH,
    intendedCamRootOwner: OWNER, intendedPaymentAdmin: ADMIN, nullClaimPeriod: 0,
  }
}

function artifact() {
  return {
    schema: DEPLOYMENT_SCHEMA, sourceCommit: SOURCE, chainId: 11155111,
    camURI: plan().camURI, camHash: HASH, deployer: ADMIN,
    intendedCamRootOwner: OWNER, intendedPaymentAdmin: ADMIN, nullClaimPeriod: 0,
    camRoot: ROOT, payToPlay: PAYMENTS, camRootCodeHash: HASH, payToPlayCodeHash: HASH,
    camRootCreationTransaction: TX, payToPlayCreationTransaction: TX2,
    payToPlayCreationInputHash: HASH,
    payToPlayUI: UI, payToPlayUICodeHash: HASH, payToPlayUICreationTransaction: TX3,
    payToPlayUICreationInputHash: HASH,
  }
}

test("release plan requires explicit nonzero authorities and bounded claim periods, including zero", () => {
  for (const period of [0, 1, 2592000]) {
    assert.equal(parseReleasePlan(bytes({ ...plan(), nullClaimPeriod: period })).nullClaimPeriod, period)
  }
  for (const period of [-1, 0.5, 2592001, "60", null]) {
    assert.throws(() => parseReleasePlan(bytes({ ...plan(), nullClaimPeriod: period })), /claim period/i)
  }
  for (const field of ["intendedCamRootOwner", "intendedPaymentAdmin"]) {
    for (const value of [ZERO, "", null]) {
      assert.throws(() => parseReleasePlan(bytes({ ...plan(), [field]: value })))
    }
    const missing: Record<string, unknown> = { ...plan() }
    delete missing[field]
    assert.throws(() => parseReleasePlan(bytes(missing)), /fields disagree/)
  }
  for (const chain of [1337, 31337]) {
    assert.throws(() => parseReleasePlan(bytes({ ...plan(), expectedChainId: chain })), /fixture chain/)
  }
})

test("deployment parsing preserves constructor evidence and rejects ambiguous identities", () => {
  assert.deepEqual(parseDeploymentArtifact(bytes(artifact())), artifact())
  assert.equal(parseDeploymentArtifact(bytes(artifact())).intendedCamRootOwner, OWNER)
  assert.equal(parseDeploymentArtifact(bytes(artifact())).intendedPaymentAdmin, ADMIN)
  for (const change of [
    { payToPlayCreationTransaction: TX }, { payToPlay: ROOT },
    { payToPlayCreationInputHash: `0x${"00".repeat(32)}` }, { extra: true },
    { payToPlayUI: ROOT }, { payToPlayUICreationTransaction: TX2 },
    { payToPlayUICreationInputHash: `0x${"00".repeat(32)}` },
  ]) assert.throws(() => parseDeploymentArtifact(bytes({ ...artifact(), ...change })))
})

test("fresh deployment evidence requires the signing projection instead of accepting older incomplete releases", () => {
  for (const field of ["payToPlayUI", "payToPlayUICodeHash", "payToPlayUICreationTransaction", "payToPlayUICreationInputHash"]) {
    const incomplete: Record<string, unknown> = { ...artifact() }
    delete incomplete[field]
    assert.throws(() => parseDeploymentArtifact(bytes(incomplete)))
  }
  assert.throws(() => parseDeploymentArtifact(bytes({ ...artifact(), schema: "pay-to-play.deployment.v1" })))
})

test("creation input evidence is bound to the receipt transaction, deployer, and CREATE operation", () => {
  const contract = { address: PAYMENTS, transactionHash: TX2 }
  const transaction = { hash: TX2, from: ADMIN, to: null, input: "0x60006000" as Hex }
  assert.equal(creationTransactionInputHash(contract, transaction, ADMIN, "PayToPlay"), keccak256(transaction.input))
  for (const change of [{ hash: TX }, { from: ROOT }, { to: ROOT }, { input: "0x" as Hex }]) {
    assert.throws(() => creationTransactionInputHash(contract, { ...transaction, ...change }, ADMIN, "PayToPlay"))
  }
})

test("UI deployment preserves historical payment creation-input evidence without its CAM root", () => {
  const deployment = artifact()
  const backing = backingFromDeployment("pay-to-play", bytes(deployment))
  assert.equal(backing.address, deployment.payToPlay)
  assert.equal(backing.creationTransaction, deployment.payToPlayCreationTransaction)
  assert.equal(backing.creationInputHash, deployment.payToPlayCreationInputHash)
  assert.equal(backing.codeHash, deployment.payToPlayCodeHash)
  assert.equal("camRoot" in backing, false)
})
