import assert from "node:assert/strict"
import test from "node:test"

import {
  deploymentContractsFromBroadcast,
  ownershipState,
} from "./artifact-model.ts"
import {
  DEPLOYMENT_SCHEMA,
  RELEASE_PLAN_SCHEMA,
  deploymentArguments,
  parseDeploymentArtifact,
  releasePlanArguments,
  requiredNonzeroAddress,
  requiredReleaseChainId,
  requiredSourceCommit,
} from "./shared.ts"
import type {
  DeploymentArtifact,
  ReleasePlan,
} from "./shared.ts"

const SOURCE_COMMIT = "0123456789abcdef0123456789abcdef01234567"
const DEPLOYER = "0x0000000000000000000000000000000000000011"
const OWNER = "0x0000000000000000000000000000000000000022"
const ZERO = "0x0000000000000000000000000000000000000000"
const ROOT = "0x0000000000000000000000000000000000000033"
const ESCROW = "0x0000000000000000000000000000000000000044"
const UI = "0x0000000000000000000000000000000000000055"
const CAM_HASH = `0x${"aa".repeat(32)}`
const ROOT_CODE_HASH = `0x${"bb".repeat(32)}`
const ESCROW_CODE_HASH = `0x${"cc".repeat(32)}`
const UI_CODE_HASH = `0x${"dd".repeat(32)}`
const ROOT_TX = `0x${"11".repeat(32)}`
const ESCROW_TX = `0x${"22".repeat(32)}`
const UI_TX = `0x${"33".repeat(32)}`

test("release chain ID is explicit and rejects fixture chains", () => {
  assert.equal(requiredReleaseChainId("1"), 1)
  assert.equal(requiredReleaseChainId("11155111"), 11155111)
  assert.throws(() => requiredReleaseChainId("31337"), /rejects local fixture chain ID/)
  assert.throws(() => requiredReleaseChainId("1337"), /rejects local fixture chain ID/)
  assert.throws(() => requiredReleaseChainId("01"), /positive decimal integer/)
})

test("release identity fields reject silent or malformed authority", () => {
  assert.equal(requiredSourceCommit(SOURCE_COMMIT), SOURCE_COMMIT)
  assert.throws(() => requiredSourceCommit("HEAD"), /40 lowercase hexadecimal/)
  assert.equal(requiredNonzeroAddress(OWNER, "owner"), OWNER)
  assert.throws(() => requiredNonzeroAddress(ZERO, "owner"), /must not be the zero address/)
})

test("release plan companion has one exact ordered field per line", () => {
  const plan: ReleasePlan = {
    schema: RELEASE_PLAN_SCHEMA,
    sourceCommit: SOURCE_COMMIT,
    expectedChainId: 11155111,
    camURI: "https://example.test/escrow/cam/main.json",
    camHash: CAM_HASH,
    intendedCamRootOwner: OWNER,
  }

  assert.equal(releasePlanArguments(plan), [
    RELEASE_PLAN_SCHEMA,
    SOURCE_COMMIT,
    "11155111",
    plan.camURI,
    CAM_HASH,
    OWNER,
    "",
  ].join("\n"))
})

test("deployment JSON and companion preserve the same strict record", () => {
  const artifact = deploymentArtifact()
  const parsed = parseDeploymentArtifact(
    new TextEncoder().encode(JSON.stringify(artifact)),
  )
  assert.deepEqual(parsed, artifact)
  assert.equal(deploymentArguments(parsed), [
    DEPLOYMENT_SCHEMA,
    SOURCE_COMMIT,
    "11155111",
    artifact.camURI,
    CAM_HASH,
    OWNER,
    ROOT,
    ESCROW,
    UI,
    ROOT_CODE_HASH,
    ESCROW_CODE_HASH,
    UI_CODE_HASH,
    "",
  ].join("\n"))

  assert.throws(
    () => parseDeploymentArtifact(new TextEncoder().encode(JSON.stringify({
      ...artifact,
      camHash: `0x${"00".repeat(32)}`,
    }))),
    /deployment camHash must not be zero/,
  )
})

test("Forge broadcast extraction requires exactly one create per release contract", () => {
  assert.deepEqual(deploymentContractsFromBroadcast({
    transactions: [
      create("CamRoot", ROOT, ROOT_TX),
      create("CamEscrow", ESCROW, ESCROW_TX),
      create("CamEscrowUI", UI, UI_TX),
    ],
  }), {
    camRoot: { address: ROOT, transactionHash: ROOT_TX },
    camEscrow: { address: ESCROW, transactionHash: ESCROW_TX },
    camEscrowUI: { address: UI, transactionHash: UI_TX },
  })

  assert.throws(() => deploymentContractsFromBroadcast({
    transactions: [
      create("CamRoot", ROOT, ROOT_TX),
      create("CamRoot", ROOT, ROOT_TX),
      create("CamEscrow", ESCROW, ESCROW_TX),
      create("CamEscrowUI", UI, UI_TX),
    ],
  }), /create CamRoot exactly once/)
})

test("ownership classification distinguishes pending and accepted handoff", () => {
  assert.deepEqual(ownershipState({
    deployer: DEPLOYER,
    intendedOwner: OWNER,
    owner: DEPLOYER,
    pendingOwner: OWNER,
  }), {
    ownershipTransferRequired: true,
    ownershipAccepted: false,
  })

  assert.deepEqual(ownershipState({
    deployer: DEPLOYER,
    intendedOwner: OWNER,
    owner: OWNER,
    pendingOwner: ZERO,
  }), {
    ownershipTransferRequired: true,
    ownershipAccepted: true,
  })

  assert.throws(() => ownershipState({
    deployer: DEPLOYER,
    intendedOwner: OWNER,
    owner: DEPLOYER,
    pendingOwner: ZERO,
  }), /unexpected CamRoot ownership state/)
})

function deploymentArtifact(): DeploymentArtifact {
  return {
    schema: DEPLOYMENT_SCHEMA,
    sourceCommit: SOURCE_COMMIT,
    chainId: 11155111,
    deployer: DEPLOYER,
    camURI: "https://example.test/escrow/cam/main.json",
    camHash: CAM_HASH,
    intendedCamRootOwner: OWNER,
    ownershipTransferRequired: true,
    ownershipAccepted: false,
    camRoot: ROOT,
    camEscrow: ESCROW,
    camEscrowUI: UI,
    camRootCodeHash: ROOT_CODE_HASH,
    camEscrowCodeHash: ESCROW_CODE_HASH,
    camEscrowUICodeHash: UI_CODE_HASH,
    camRootCreationTransaction: ROOT_TX,
    camEscrowCreationTransaction: ESCROW_TX,
    camEscrowUICreationTransaction: UI_TX,
  }
}

function create(contractName: string, contractAddress: string, hash: string): unknown {
  return {
    transactionType: "CREATE",
    contractName,
    contractAddress,
    hash,
  }
}
