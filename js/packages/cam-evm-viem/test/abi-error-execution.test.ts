import assert from "node:assert/strict"
import test from "node:test"

import { parseCam } from "@cam/core"
import {
  ContractFunctionExecutionError,
  ContractFunctionRevertedError,
  createPublicClient,
  encodeErrorResult,
  http,
  toFunctionSelector,
} from "viem"
import type { Abi, Hex } from "viem"

import {
  CamEvmError,
  callCamRoute,
  simulateCamContractCall,
} from "../src/index.ts"
import { bikeCamJson } from "../../../../tests/fixtures/cam/bike-resources.mts"
import {
  BIKE_ACCOUNT_ADDRESS,
  BIKE_ROUTE_COMPONENT,
  BIKE_SERIAL_NUMBER,
  BIKE_UI_ADDRESS,
  BIKE_UI_NAMESPACE,
  BIKE_VIEW_COMPONENT,
  bikeHost,
} from "../../../../tests/fixtures/cam/bike.mts"

const errors = [
  { type: "error", name: "InvalidReferenceLength", inputs: [{ name: "length", type: "uint256" }] },
  { type: "error", name: "WrongActor", inputs: [{ name: "actor", type: "address" }] },
] as const satisfies Abi

test("write simulation decodes declared custom errors while selecting one overloaded function", async () => {
  const abi = [
    { type: "function", name: "fund", stateMutability: "payable", inputs: [{ name: "amount", type: "uint256" }], outputs: [] },
    { type: "function", name: "fund", stateMutability: "payable", inputs: [{ name: "memo", type: "string" }], outputs: [] },
    ...errors,
  ] as const satisfies Abi
  const revertData = encodeErrorResult({ abi, errorName: "InvalidReferenceLength", args: [0n] })
  const client = revertingClient(revertData)

  await assert.rejects(
    () => simulateCamContractCall({
      publicClient: client,
      account: BIKE_ACCOUNT_ADDRESS,
      call: {
        address: BIKE_UI_ADDRESS,
        abi,
        function: "fund(uint256)",
        args: { amount: "1" },
        value: "1",
      },
    }),
    (error) => hasDecodedRevert(error, "CAM_WRITE_SIMULATION_FAILED", "InvalidReferenceLength", [0n]),
  )
  assert.equal(client.calls[0]?.data?.slice(0, 10), toFunctionSelector("fund(uint256)"))
})

test("read route decodes declared custom errors from a real viem client", async () => {
  const uiAbi = [
    { type: "function", name: BIKE_VIEW_COMPONENT, stateMutability: "view", inputs: [
      { name: "serialNumber", type: "string" },
      { name: "account", type: "address" },
    ], outputs: [{ name: "view", type: "tuple", components: [] }] },
    { type: "function", name: "unrelated", stateMutability: "view", inputs: [], outputs: [] },
    ...errors,
  ] as const satisfies Abi
  const revertData = encodeErrorResult({ abi: uiAbi, errorName: "WrongActor", args: [BIKE_ACCOUNT_ADDRESS] })
  const client = revertingClient(revertData)

  await assert.rejects(
    () => callCamRoute({
      publicClient: client,
      cam: parseCam(bikeCamJson),
      contracts: {
        [BIKE_UI_NAMESPACE]: { address: BIKE_UI_ADDRESS, abi: uiAbi },
      },
      route: BIKE_ROUTE_COMPONENT,
      context: {
        host: bikeHost,
        account: { address: BIKE_ACCOUNT_ADDRESS },
        inputs: { serialNumber: BIKE_SERIAL_NUMBER },
        outputs: [],
      },
    }),
    (error) => hasDecodedRevert(error, "CAM_ROUTE_CALL_FAILED", "WrongActor", [BIKE_ACCOUNT_ADDRESS]),
  )
  assert.equal(client.calls.length, 1)
})

test("unknown revert selectors retain raw evidence without inventing a custom error", async () => {
  const abi = [
    { type: "function", name: "fund", stateMutability: "payable", inputs: [], outputs: [] },
    ...errors,
  ] as const satisfies Abi
  const client = revertingClient("0xdeadbeef")

  await assert.rejects(
    () => simulateCamContractCall({
      publicClient: client,
      account: BIKE_ACCOUNT_ADDRESS,
      call: { address: BIKE_UI_ADDRESS, abi, function: "fund", args: {}, value: "1" },
    }),
    (error) => {
      const revert = contractRevert(error, "CAM_WRITE_SIMULATION_FAILED")
      return revert?.data === undefined && revert?.raw === "0xdeadbeef"
    },
  )
})

function hasDecodedRevert(error: unknown, code: CamEvmError["code"], name: string, args: readonly unknown[]): boolean {
  const revert = contractRevert(error, code)
  if (revert?.data?.errorName !== name) return false
  assert.deepEqual(revert.data.args, args)
  return true
}

function contractRevert(error: unknown, code: CamEvmError["code"]): ContractFunctionRevertedError | undefined {
  if (!(error instanceof CamEvmError) || error.code !== code) return undefined
  const execution = error.cause
  if (!(execution instanceof ContractFunctionExecutionError)) return undefined
  return execution.cause instanceof ContractFunctionRevertedError ? execution.cause : undefined
}

function revertingClient(revertData: Hex) {
  const calls: Array<{ data?: Hex }> = []
  const client = createPublicClient({
    transport: http("http://127.0.0.1:8545", {
      retryCount: 0,
      async fetchFn(_input, init) {
        const request = JSON.parse(String(init?.body)) as {
          readonly id: number
          readonly method: string
          readonly params?: readonly [{ readonly data?: Hex }]
        }
        if (request.method === "eth_call") {
          const data = request.params?.[0]?.data
          calls.push(data === undefined ? {} : { data })
        }
        const result = request.method === "eth_chainId"
          ? { result: "0x7a69" }
          : { error: { code: 3, message: "execution reverted", data: revertData } }
        return new Response(JSON.stringify({ jsonrpc: "2.0", id: request.id, ...result }), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
      },
    }),
  })
  return Object.assign(client, { calls })
}
