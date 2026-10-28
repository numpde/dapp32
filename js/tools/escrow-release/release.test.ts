import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import {
  readFileSync,
} from "node:fs"
import {
  dirname,
  join,
} from "node:path"
import test from "node:test"
import { backingFromDeployment } from "../ui-release/shared.ts"


import { fileURLToPath } from "node:url"

import type { Address, Hex } from "viem"

import { ownershipState } from "../release-ownership.ts"
import {
  inspectReleaseCamBundle,
} from "../release-cam-bundle.ts"
import {
  DEPLOYMENT_SCHEMA,
  parseDeploymentArtifact,
  parseReleasePlan,
  RELEASE_PLAN_SCHEMA,
} from "./shared.ts"
import type { DeploymentArtifact } from "./shared.ts"
import {
  createdContract,
  creationReceiptDeployer,
} from "../release-provenance.ts"
import { requiredNonzeroAddress, requiredReleaseChainId, requiredSourceCommit } from "../release-values.ts"

const SOURCE_COMMIT = "0123456789abcdef0123456789abcdef01234567"
const DEPLOYER = "0x0000000000000000000000000000000000000011" as Address
const OWNER = "0x0000000000000000000000000000000000000022" as Address
const ZERO = "0x0000000000000000000000000000000000000000" as Address
const ROOT = "0x0000000000000000000000000000000000000033" as Address
const ESCROW = "0x0000000000000000000000000000000000000044" as Address
const UI = "0x0000000000000000000000000000000000000055" as Address
const CAM_HASH = `0x${"aa".repeat(32)}` as Hex
const ROOT_CODE_HASH = `0x${"bb".repeat(32)}` as Hex
const ESCROW_CODE_HASH = `0x${"cc".repeat(32)}` as Hex
const UI_CODE_HASH = `0x${"dd".repeat(32)}` as Hex
const ROOT_TX = `0x${"11".repeat(32)}` as Hex
const ESCROW_TX = `0x${"22".repeat(32)}` as Hex
const UI_TX = `0x${"33".repeat(32)}` as Hex
const DAPPS_ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../../dapps")
const CHECKED_IN_CAM_HASH = `0x${createHash("sha256").update(readFileSync(join(DAPPS_ROOT, "escrow/cam/main.json"))).digest("hex")}` as Hex

test("release parsing rejects the old Keccak commitment schemas", () => {
  assert.throws(() => parseReleasePlan(new TextEncoder().encode(JSON.stringify({
    schema: "escrow.release-plan.v1", sourceCommit: SOURCE_COMMIT, expectedChainId: 11155111,
    camURI: "https://example.test/escrow/cam/main.json", camHash: CAM_HASH, intendedCamRootOwner: OWNER,
  }))), /unsupported release plan schema/)
  assert.throws(() => parseDeploymentArtifact(new TextEncoder().encode(JSON.stringify({
    ...deploymentArtifact(), schema: "escrow.deployment.v1",
  }))), /unsupported deployment artifact schema/)
})

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

test("escrow release parsing preserves shared identity rules and nonempty text", () => {
  const plan = {
    schema: RELEASE_PLAN_SCHEMA,
    sourceCommit: SOURCE_COMMIT,
    expectedChainId: 11155111,
    camURI: "https://example.test/escrow/cam/main.json\nmirror",
    camHash: CAM_HASH,
    intendedCamRootOwner: OWNER,
  }
  assert.equal(
    parseReleasePlan(new TextEncoder().encode(JSON.stringify(plan))).camURI,
    plan.camURI,
  )
  assert.throws(
    () => parseReleasePlan(new TextEncoder().encode(JSON.stringify({ ...plan, sourceCommit: "HEAD" }))),
    /40 lowercase hexadecimal/,
  )
  assert.throws(
    () => parseReleasePlan(new TextEncoder().encode(JSON.stringify({ ...plan, expectedChainId: 31337 }))),
    /rejects local fixture chain ID/,
  )
  assert.throws(
    () => parseReleasePlan(new TextEncoder().encode(JSON.stringify({ ...plan, intendedCamRootOwner: ZERO }))),
    /must not be the zero address/,
  )
})

test("escrow release inspection reports SHA-256 of the exact checked-in manifest bytes", async () => {
  const bundle = await inspectReleaseCamBundle({
    dappsRootPath: DAPPS_ROOT,
    rootPath: join(DAPPS_ROOT, "escrow/cam/main.json"),
    camURI: "https://example.test/escrow/cam/main.json",
    label: "escrow",
  })
  assert.equal(bundle.camHash, CHECKED_IN_CAM_HASH)
})

test("deployment JSON preserves the complete strict record", () => {
  const artifact = deploymentArtifact()
  const parsed = parseDeploymentArtifact(
    new TextEncoder().encode(JSON.stringify(artifact)),
  )
  assert.deepEqual(parsed, artifact)
  const zeroDigest = `0x${"00".repeat(32)}`
  assert.equal(parseDeploymentArtifact(new TextEncoder().encode(JSON.stringify({
    ...artifact, camHash: zeroDigest,
  }))).camHash, zeroDigest)
  assert.throws(
    () => parseDeploymentArtifact(new TextEncoder().encode(JSON.stringify({
      ...artifact,
      extra: true,
    }))),
    /unexpected=\[extra\]/,
  )
  const { ownershipAccepted: _ownershipAccepted, ...missingOwnershipAccepted } = artifact
  assert.throws(
    () => parseDeploymentArtifact(new TextEncoder().encode(JSON.stringify({
      ...missingOwnershipAccepted,
      extra: true,
    }))),
    /escrow deployment artifact fields disagree: missing=\[ownershipAccepted\] unexpected=\[extra\]/,
  )
  assert.throws(
    () => parseDeploymentArtifact(new TextEncoder().encode(JSON.stringify({
      ...artifact,
      ownershipTransferRequired: false,
    }))),
    /ownershipTransferRequired disagrees/,
  )
  assert.throws(
    () => parseDeploymentArtifact(new TextEncoder().encode(JSON.stringify({
      ...artifact,
      camEscrowCreationTransaction: ROOT_TX,
    }))),
    /creation transaction hashes must be distinct/,
  )
  assert.throws(
    () => parseDeploymentArtifact(new TextEncoder().encode(JSON.stringify({
      ...artifact,
      camRootCreationTransaction: `0x${"00".repeat(32)}`,
    }))),
    /camRootCreationTransaction must not be zero/,
  )
})

test("Forge broadcast extraction requires exactly one named creation", () => {
  const transactions = [
    create("CamRoot", ROOT, ROOT_TX),
    create("CamEscrow", ESCROW, ESCROW_TX),
    create("CamEscrowUI", UI, UI_TX),
  ]
  assert.deepEqual(createdContract(transactions, "CamEscrow"), { address: ESCROW, transactionHash: ESCROW_TX })
  assert.throws(() => createdContract([...transactions, create("CamEscrow", ESCROW, ESCROW_TX)], "CamEscrow"), /create CamEscrow exactly once/)
})
test("creation receipts are bound to broadcast hashes and contract addresses", () => {
  const contract = { address: ROOT, transactionHash: ROOT_TX }
  assert.equal(creationReceiptDeployer(contract, {
    status: "success",
    contractAddress: ROOT,
    transactionHash: ROOT_TX,
    from: DEPLOYER,
    to: null,
  }, "CamRoot"), DEPLOYER)

  assert.throws(() => creationReceiptDeployer(contract, {
    status: "success",
    contractAddress: ESCROW,
    transactionHash: ROOT_TX,
    from: DEPLOYER,
    to: null,
  }, "CamRoot"), /creation receipt address mismatch/)
  assert.throws(() => creationReceiptDeployer(contract, {
    status: "success",
    contractAddress: ROOT,
    transactionHash: ESCROW_TX,
    from: DEPLOYER,
    to: null,
  }, "CamRoot"), /receipt transaction hash does not match/)
  assert.throws(() => creationReceiptDeployer(contract, {
    status: "success",
    contractAddress: ROOT,
    transactionHash: ROOT_TX,
    from: DEPLOYER,
    to: ESCROW,
  }, "CamRoot"), /unexpectedly has a destination/)
  assert.throws(() => creationReceiptDeployer(contract, {
    status: "success",
    contractAddress: undefined,
    transactionHash: ROOT_TX,
    from: DEPLOYER,
    to: null,
  }, "CamRoot"), /has no contract address/)
  assert.throws(() => creationReceiptDeployer(contract, {
    status: "reverted",
    contractAddress: null,
    transactionHash: ROOT_TX,
    from: DEPLOYER,
    to: null,
  }, "CamRoot"), /did not succeed/)
})

test("ownership classification distinguishes pending and accepted handoff", () => {
  assert.deepEqual(ownershipState({ label: "CamRoot",
    deployer: DEPLOYER,
    intendedOwner: OWNER,
    owner: DEPLOYER,
    pendingOwner: OWNER,
  }), {
    ownershipTransferRequired: true,
    ownershipAccepted: false,
  })

  assert.deepEqual(ownershipState({ label: "CamRoot",
    deployer: DEPLOYER,
    intendedOwner: OWNER,
    owner: OWNER,
    pendingOwner: ZERO,
  }), {
    ownershipTransferRequired: true,
    ownershipAccepted: true,
  })

  assert.throws(() => ownershipState({ label: "CamRoot",
    deployer: DEPLOYER,
    intendedOwner: OWNER,
    owner: DEPLOYER,
    pendingOwner: ZERO,
  }), /unexpected CamRoot handoff state/)
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


test("UI deployment selects historical escrow identity without its root or old UI", () => {
  const artifact = deploymentArtifact()
  const backing = backingFromDeployment("escrow", new TextEncoder().encode(JSON.stringify(artifact)))
  assert.equal(backing.address, artifact.camEscrow)
  assert.equal(backing.creationTransaction, artifact.camEscrowCreationTransaction)
  assert.equal(backing.codeHash, artifact.camEscrowCodeHash)
  assert.equal(backing.creator, artifact.deployer)
  assert.equal("camRoot" in backing, false)
})
