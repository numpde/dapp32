import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"
import { keccak256 } from "viem"
import type { Address, Hex } from "viem"
import { parseReleasePlan, parseDeploymentArtifact, RELEASE_PLAN_SCHEMA, DEPLOYMENT_SCHEMA } from "./shared.ts"
import { creationTransactionInputHash } from "../release-provenance.ts"

const SOURCE = "0123456789abcdef0123456789abcdef01234567"
const ADMIN = "0x0000000000000000000000000000000000000011" as Address
const OWNER = "0x0000000000000000000000000000000000000044" as Address
const ROOT = "0x0000000000000000000000000000000000000022" as Address
const PAYMENTS = "0x0000000000000000000000000000000000000033" as Address
const HASH = `0x${"ab".repeat(32)}` as Hex
const TX = `0x${"12".repeat(32)}` as Hex
const TX2 = `0x${"34".repeat(32)}` as Hex
const ZERO = "0x0000000000000000000000000000000000000000"
const DAPPS = join(dirname(fileURLToPath(import.meta.url)), "../../../dapps")
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
  assert.equal(parseDeploymentArtifact(bytes(artifact())).payToPlayCreationInputHash, HASH)
  assert.equal(parseDeploymentArtifact(bytes(artifact())).intendedCamRootOwner, OWNER)
  assert.equal(parseDeploymentArtifact(bytes(artifact())).intendedPaymentAdmin, ADMIN)
  for (const change of [
    { payToPlayCreationTransaction: TX }, { payToPlay: ROOT },
    { payToPlayCreationInputHash: `0x${"00".repeat(32)}` }, { extra: true },
  ]) assert.throws(() => parseDeploymentArtifact(bytes({ ...artifact(), ...change })))
})

test("creation input evidence is bound to the receipt transaction, deployer, and CREATE operation", () => {
  const contract = { address: PAYMENTS, transactionHash: TX2 }
  const transaction = { hash: TX2, from: ADMIN, to: null, input: "0x60006000" as Hex }
  assert.equal(creationTransactionInputHash(contract, transaction, ADMIN, "PayToPlay"), keccak256(transaction.input))
  for (const change of [{ hash: TX }, { from: ROOT }, { to: ROOT }, { input: "0x" as Hex }]) {
    assert.throws(() => creationTransactionInputHash(contract, { ...transaction, ...change }, ADMIN, "PayToPlay"))
  }
})

test("offline planner pins actual CAM bytes and never silently supplies release policy", () => {
  const dir = mkdtempSync(join(tmpdir(), "pay-to-play-release-"))
  try {
    const env = {
      ...process.env, PAY_TO_PLAY_RELEASE_DAPPS_ROOT: DAPPS,
      PAY_TO_PLAY_RELEASE_CAM_ROOT_PATH: join(DAPPS, "pay-to-play/cam/main.json"),
      PAY_TO_PLAY_RELEASE_PLAN_PATH: join(dir, "plan.json"),
      PAY_TO_PLAY_RELEASE_CAM_URI: plan().camURI, PAY_TO_PLAY_RELEASE_SOURCE_COMMIT: SOURCE,
      PAY_TO_PLAY_RELEASE_EXPECTED_CHAIN_ID: "11155111",
      PAY_TO_PLAY_RELEASE_INTENDED_CAM_ROOT_OWNER: OWNER,
      PAY_TO_PLAY_RELEASE_INTENDED_PAYMENT_ADMIN: ADMIN,
      PAY_TO_PLAY_RELEASE_NULL_CLAIM_PERIOD: "0",
    }
    const run = (inputs: NodeJS.ProcessEnv) => spawnSync(process.execPath, ["--experimental-strip-types", join(dirname(fileURLToPath(import.meta.url)), "plan.ts")], { env: inputs, encoding: "utf8" })
    const success = run(env)
    assert.equal(success.status, 0, success.stderr)
    const planned = parseReleasePlan(readFileSync(env.PAY_TO_PLAY_RELEASE_PLAN_PATH))
    assert.equal(planned.intendedCamRootOwner, OWNER)
    assert.equal(planned.intendedPaymentAdmin, ADMIN)
    assert.equal(planned.camHash, `0x${createHash("sha256").update(readFileSync(env.PAY_TO_PLAY_RELEASE_CAM_ROOT_PATH)).digest("hex")}`)
    for (const field of ["PAY_TO_PLAY_RELEASE_INTENDED_PAYMENT_ADMIN", "PAY_TO_PLAY_RELEASE_NULL_CLAIM_PERIOD"]) {
      const missing: NodeJS.ProcessEnv = { ...env }
      delete missing[field]
      const failure = run(missing)
      assert.notEqual(failure.status, 0, field)
      assert.match(failure.stderr, new RegExp(field))
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
