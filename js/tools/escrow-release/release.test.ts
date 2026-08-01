import assert from "node:assert/strict"
import test from "node:test"

import {
  deploymentContractsFromBroadcast,
  ownershipState,
} from "./artifact-model.ts"
import {
  requiredNonzeroAddress,
  requiredReleaseChainId,
  requiredSourceCommit,
} from "./shared.ts"

const DEPLOYER = "0x0000000000000000000000000000000000000011"
const OWNER = "0x0000000000000000000000000000000000000022"
const ZERO = "0x0000000000000000000000000000000000000000"
const ROOT = "0x0000000000000000000000000000000000000033"
const ESCROW = "0x0000000000000000000000000000000000000044"
const UI = "0x0000000000000000000000000000000000000055"
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
  assert.equal(
    requiredSourceCommit("0123456789abcdef0123456789abcdef01234567"),
    "0123456789abcdef0123456789abcdef01234567",
  )
  assert.throws(() => requiredSourceCommit("HEAD"), /40 lowercase hexadecimal/)
  assert.equal(requiredNonzeroAddress(OWNER, "owner"), OWNER)
  assert.throws(() => requiredNonzeroAddress(ZERO, "owner"), /must not be the zero address/)
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

function create(contractName: string, contractAddress: string, hash: string): unknown {
  return {
    transactionType: "CREATE",
    contractName,
    contractAddress,
    hash,
  }
}
