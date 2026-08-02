import assert from "node:assert/strict"
import {
  mkdtemp,
  readFile,
  readdir,
  rm,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import {
  dirname,
  join,
} from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

import type { Address, Hex } from "viem"

import {
  creationReceiptDeployer,
  deploymentContractsFromBroadcast,
  ownershipState,
} from "./artifact-model.ts"
import {
  buildReleasePlan,
} from "./bundle.ts"
import {
  DEPLOYMENT_SCHEMA,
  RELEASE_PLAN_SCHEMA,
  parseDeploymentArtifact,
  releasePlanArguments,
  requiredNonzeroAddress,
  requiredReleaseChainId,
  requiredSourceCommit,
  writeNewText,
} from "./shared.ts"
import type {
  DeploymentArtifact,
  ReleasePlan,
} from "./shared.ts"

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
const CHECKED_IN_CAM_HASH = "0x08f41b8991602fa55e28230933cf6642345a28d1bbf0c18215ae044608a6fb66"
const DAPPS_ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../../dapps")

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

test("checked-in escrow bundle reproduces the accepted release hash", async () => {
  const plan = await buildReleasePlan({
    dappsRootPath: DAPPS_ROOT,
    rootPath: join(DAPPS_ROOT, "escrow/cam/main.json"),
    camURI: "https://example.test/escrow/cam/main.json",
    sourceCommit: SOURCE_COMMIT,
    expectedChainId: 11155111,
    intendedCamRootOwner: OWNER,
  })
  assert.equal(plan.camHash, CHECKED_IN_CAM_HASH)
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

test("deployment JSON preserves the complete strict record", () => {
  const artifact = deploymentArtifact()
  const parsed = parseDeploymentArtifact(
    new TextEncoder().encode(JSON.stringify(artifact)),
  )
  assert.deepEqual(parsed, artifact)
  assert.throws(
    () => parseDeploymentArtifact(new TextEncoder().encode(JSON.stringify({
      ...artifact,
      camHash: `0x${"00".repeat(32)}`,
    }))),
    /deployment camHash must not be zero/,
  )
  assert.throws(
    () => parseDeploymentArtifact(new TextEncoder().encode(JSON.stringify({
      ...artifact,
      extra: true,
    }))),
    /unexpected=\[extra\]/,
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

test("release file publication is no-clobber and leaves no staging file", async () => {
  const directory = await mkdtemp(join(tmpdir(), "escrow-release-test-"))
  const path = join(directory, "deployment.json")
  try {
    await writeNewText(path, "first\n", "deployment artifact")
    assert.equal(await readFile(path, "utf-8"), "first\n")
    await assert.rejects(writeNewText(path, "second\n", "deployment artifact"))
    assert.equal(await readFile(path, "utf-8"), "first\n")
    assert.deepEqual(await readdir(directory), ["deployment.json"])
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
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
