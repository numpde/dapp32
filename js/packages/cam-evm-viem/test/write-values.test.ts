import assert from "node:assert/strict"
import test from "node:test"

import type { Abi, Address, Chain, Hex } from "viem"

import {
  CamEvmError,
  sendCamContractCall,
  simulateCamContractCall,
} from "../src/index.ts"
import type {
  CamContractCall,
  CamEvmErrorCode,
  CamSimulationClient,
  CamWalletClient,
} from "../src/index.ts"

const account = "0x0000000000000000000000000000000000000001" as Address
const contract = "0x0000000000000000000000000000000000000002" as Address
const txHash = "0x1234" as Hex
const chain: Chain = {
  id: 31337,
  name: "CAM test chain",
  nativeCurrency: {
    name: "Ether",
    symbol: "ETH",
    decimals: 18,
  },
  rpcUrls: {
    default: {
      http: ["http://127.0.0.1:8545"],
    },
  },
}

const payableAbi = [{
  type: "function",
  name: "fund",
  stateMutability: "payable",
  inputs: [{ name: "memo", type: "string" }],
  outputs: [],
}] as const satisfies Abi

const nonpayableAbi = [{
  type: "function",
  name: "save",
  stateMutability: "nonpayable",
  inputs: [],
  outputs: [],
}] as const satisfies Abi

const viewAbi = [{
  type: "function",
  name: "viewEntry",
  stateMutability: "view",
  inputs: [],
  outputs: [],
}] as const satisfies Abi

test("simulation and wallet submission receive the same normalized transaction value", async () => {
  const simulationCalls: Array<Parameters<CamSimulationClient["simulateContract"]>[0]> = []
  const walletCalls: Array<Parameters<CamWalletClient["writeContract"]>[0]> = []
  const publicClient: CamSimulationClient = {
    async simulateContract(request) {
      simulationCalls.push(request)
    },
  }
  const walletClient: CamWalletClient = {
    async writeContract(request) {
      walletCalls.push(request)
      return txHash
    },
  }
  const call = payableCall("1000000000000000000")

  await simulateCamContractCall({ publicClient, account, call })
  assert.equal(await sendCamContractCall({ walletClient, chain, call }), txHash)

  assert.deepEqual(simulationCalls, [{
    address: contract,
    abi: payableAbi,
    functionName: "fund",
    args: ["escrow"],
    value: 1000000000000000000n,
    account,
  }])
  assert.deepEqual(walletCalls, [{
    address: contract,
    abi: payableAbi,
    functionName: "fund",
    args: ["escrow"],
    value: 1000000000000000000n,
    chain,
  }])
})

test("transaction value accepts the full uint256 runtime range", async () => {
  const values = [
    0,
    "0",
    "115792089237316195423570985008687907853269984665640564039457584007913129639935",
  ] as const

  for (const value of values) {
    let normalized: bigint | undefined
    await simulateCamContractCall({
      publicClient: {
        async simulateContract(request) {
          normalized = request.value
        },
      },
      account,
      call: payableCall(value),
    })
    assert.equal(normalized, BigInt(value), String(value))
  }
})

test("payable and nonpayable runtime calls enforce value presence", async () => {
  await assertWriteError({
    address: contract,
    abi: payableAbi,
    function: "fund",
    args: { memo: "escrow" },
  }, "CAM_WRITE_FUNCTION_PAYABLE_UNSUPPORTED")

  await assertWriteError({
    address: contract,
    abi: nonpayableAbi,
    function: "save",
    args: {},
    value: "1",
  }, "CAM_WRITE_INVALID_VALUE")
})

test("transaction value rejects non-decimal and out-of-range inert values", async () => {
  for (const value of [
    -1,
    "-1",
    "0x01",
    true,
    "1.5",
    "115792089237316195423570985008687907853269984665640564039457584007913129639936",
  ] as const) {
    await assertWriteError(payableCall(value), "CAM_WRITE_INVALID_VALUE", String(value))
  }
})

test("read-only functions remain invalid write targets", async () => {
  await assertWriteError({
    address: contract,
    abi: viewAbi,
    function: "viewEntry",
    args: {},
  }, "CAM_WRITE_FUNCTION_NOT_MUTABLE")
})

function payableCall(value: CamContractCall["value"]): CamContractCall {
  return {
    address: contract,
    abi: payableAbi,
    function: "fund",
    args: {
      memo: "escrow",
    },
    ...(value === undefined ? {} : { value }),
  }
}

async function assertWriteError(
  call: CamContractCall,
  code: CamEvmErrorCode,
  label?: string,
): Promise<void> {
  await assert.rejects(
    () => simulateCamContractCall({
      publicClient: noopSimulationClient(),
      account,
      call,
    }),
    (error) => error instanceof CamEvmError && error.code === code,
    label,
  )
}

function noopSimulationClient(): CamSimulationClient {
  return {
    async simulateContract() {},
  }
}
