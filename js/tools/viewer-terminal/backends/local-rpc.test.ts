import assert from "node:assert/strict"
import test from "node:test"

import { deploymentFromBroadcast, traceContractArgs } from "./local-rpc.ts"

const ACCOUNT = "0x0000000000000000000000000000000000000001"
const CAM_ROOT = "0x0000000000000000000000000000000000000002"
const OTHER_CAM_ROOT = "0x0000000000000000000000000000000000000003"
const OTHER_ACCOUNT = "0x0000000000000000000000000000000000000004"
const CAM_ROOT_TX_HASH = "0x00000000000000000000000000000000000000000000000000000000000000a1"
const OTHER_TX_HASH = "0x00000000000000000000000000000000000000000000000000000000000000a2"

test("Forge broadcast deployment parser rejects ambiguous CamRoot creates", () => {
  assert.throws(
    () => deploymentFromBroadcast(broadcast({
      transactions: [
        createCamRoot(CAM_ROOT),
        createCamRoot(OTHER_CAM_ROOT),
      ],
    })),
    /created CamRoot more than once/,
  )
})

test("Forge broadcast deployment parser rejects ambiguous receipt senders", () => {
  assert.throws(
    () => deploymentFromBroadcast(broadcast({
      receipts: [
        { transactionHash: CAM_ROOT_TX_HASH, from: ACCOUNT },
        { transactionHash: CAM_ROOT_TX_HASH, from: OTHER_ACCOUNT },
      ],
    })),
    /multiple receipt senders/,
  )
})

test("Forge broadcast deployment parser ignores unrelated receipt senders", () => {
  assert.deepEqual(deploymentFromBroadcast(broadcast({
    receipts: [
      { transactionHash: OTHER_TX_HASH, from: OTHER_ACCOUNT },
      { transactionHash: CAM_ROOT_TX_HASH, from: ACCOUNT },
    ],
  })).account, ACCOUNT)
})

test("Forge broadcast deployment parser requires the CamRoot deployment receipt", () => {
  assert.throws(
    () => deploymentFromBroadcast(broadcast({
      receipts: [
        { transactionHash: OTHER_TX_HASH, from: ACCOUNT },
      ],
    })),
    /no receipt for deployment transaction/,
  )
})

test("Forge broadcast deployment parser returns the unambiguous deployment", () => {
  assert.deepEqual(deploymentFromBroadcast(broadcast({})), {
    chainId: "eip155:31337",
    account: ACCOUNT,
    camRoot: CAM_ROOT,
  })
})

test("local RPC trace preserves viem integer args without inert coercion", () => {
  assert.deepEqual(traceContractArgs([1n, "serial"]), [1n, "serial"])
  assert.deepEqual(traceContractArgs(undefined), [])
})

function broadcast({
  transactions,
  receipts,
}: {
  readonly transactions?: readonly unknown[]
  readonly receipts?: readonly unknown[]
}): unknown {
  return {
    chain: 31337,
    transactions: transactions === undefined ? [createCamRoot(CAM_ROOT)] : transactions,
    receipts: receipts === undefined ? [{ transactionHash: CAM_ROOT_TX_HASH, from: ACCOUNT }] : receipts,
  }
}

function createCamRoot(contractAddress: string): unknown {
  return {
    transactionType: "CREATE",
    contractName: "CamRoot",
    contractAddress,
    hash: contractAddress === CAM_ROOT ? CAM_ROOT_TX_HASH : OTHER_TX_HASH,
  }
}
