import assert from "node:assert/strict"
import test from "node:test"

import { deploymentFromBroadcast } from "./local-rpc.ts"

const ACCOUNT = "0x0000000000000000000000000000000000000001"
const CAM_ROOT = "0x0000000000000000000000000000000000000002"
const OTHER_CAM_ROOT = "0x0000000000000000000000000000000000000003"
const OTHER_ACCOUNT = "0x0000000000000000000000000000000000000004"

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
        { from: ACCOUNT },
        { from: OTHER_ACCOUNT },
      ],
    })),
    /multiple receipt senders/,
  )
})

test("Forge broadcast deployment parser returns the unambiguous deployment", () => {
  assert.deepEqual(deploymentFromBroadcast(broadcast({})), {
    chainId: "eip155:31337",
    account: ACCOUNT,
    camRoot: CAM_ROOT,
  })
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
    receipts: receipts === undefined ? [{ from: ACCOUNT }] : receipts,
  }
}

function createCamRoot(contractAddress: string): unknown {
  return {
    transactionType: "CREATE",
    contractName: "CamRoot",
    contractAddress,
  }
}
