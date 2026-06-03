import type { Hex } from "viem"

import { abiFunctionInputs, normalizeAbiArgs } from "./arguments.ts"
import { findUniqueAbiFunction, singleFunctionAbi } from "./abi-functions.ts"
import { CamEvmError } from "./errors.ts"
import type { CamContractCall, SendCamContractCallOptions, SimulateCamContractCallOptions } from "./types.ts"

type WriteRequest = {
  readonly address: CamContractCall["address"]
  readonly abi: CamContractCall["abi"]
  readonly functionName: string
  readonly args: readonly unknown[]
}

export async function sendCamContractCall({
  walletClient,
  chain,
  call,
}: SendCamContractCallOptions): Promise<Hex> {
  const request = writeRequest(call)

  try {
    return await walletClient.writeContract({
      ...request,
      chain,
    })
  } catch (cause) {
    throw new CamEvmError("CAM_WRITE_FAILED", `failed to send CAM contract call: ${call.function}`, cause)
  }
}

export async function simulateCamContractCall({
  publicClient,
  account,
  call,
}: SimulateCamContractCallOptions): Promise<void> {
  const request = writeRequest(call)

  try {
    await publicClient.simulateContract({
      ...request,
      account,
    })
  } catch (cause) {
    throw new CamEvmError("CAM_WRITE_SIMULATION_FAILED", `CAM write simulation failed: ${call.function}`, cause)
  }
}

function writeRequest(call: CamContractCall): WriteRequest {
  const fn = findUniqueAbiFunction({
    abi: call.abi,
    functionName: call.function,
    notFoundCode: "CAM_WRITE_FUNCTION_NOT_FOUND",
    ambiguousCode: "CAM_WRITE_FUNCTION_AMBIGUOUS",
    purpose: "write",
  })

  if (fn.stateMutability === "payable") {
    throw new CamEvmError(
      "CAM_WRITE_FUNCTION_PAYABLE_UNSUPPORTED",
      `CAM write function is payable but CAM V1 has no value model: ${call.function}`,
    )
  }
  if (fn.stateMutability !== "nonpayable") {
    throw new CamEvmError("CAM_WRITE_FUNCTION_NOT_MUTABLE", `CAM write function must be nonpayable: ${call.function}`)
  }

  return {
    address: call.address,
    abi: singleFunctionAbi(fn),
    functionName: fn.name,
    args: normalizeAbiArgs({
      inputs: abiFunctionInputs(fn, "CAM_WRITE_INVALID_ARGUMENT"),
      args: call.args,
      functionName: call.function,
      errorCode: "CAM_WRITE_INVALID_ARGUMENT",
    }),
  }
}
