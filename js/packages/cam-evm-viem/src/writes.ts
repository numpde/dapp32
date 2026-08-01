import type { Hex } from "viem"

import { abiFunctionInputs, normalizeAbiArgs } from "./arguments.ts"
import {
  evmUint256Value,
} from "./abi-values.ts"
import type {
  EvmTransactionValue,
} from "./abi-values.ts"
import { findUniqueAbiFunction, singleFunctionAbi } from "./abi-functions.ts"
import { requireEvmAddress } from "./chain.ts"
import { CamEvmError } from "./errors.ts"
import type { CamContractCall, SendCamContractCallOptions, SimulateCamContractCallOptions } from "./types.ts"

type WriteRequest = {
  readonly address: CamContractCall["address"]
  readonly abi: CamContractCall["abi"]
  readonly functionName: string
  readonly args: readonly unknown[]
  readonly value?: EvmTransactionValue
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

  const value = writeValue(call, fn.stateMutability)
  return {
    address: requireEvmAddress(call.address, "contract.address"),
    abi: singleFunctionAbi(fn),
    functionName: fn.name,
    args: normalizeAbiArgs({
      inputs: abiFunctionInputs(fn, "CAM_WRITE_INVALID_ARGUMENT"),
      args: call.args,
      functionName: call.function,
      errorCode: "CAM_WRITE_INVALID_ARGUMENT",
    }),
    ...(value === undefined ? {} : { value }),
  }
}

function writeValue(
  call: CamContractCall,
  stateMutability: "pure" | "view" | "nonpayable" | "payable",
): EvmTransactionValue | undefined {
  if (stateMutability === "payable") {
    if (call.value === undefined) {
      // Preserve the pre-1.1 runtime code for callers that already distinguish
      // a payable ABI target with no usable CAM value model. Payable calls with
      // a declared value now proceed through the normal uint256 boundary below.
      throw new CamEvmError(
        "CAM_WRITE_FUNCTION_PAYABLE_UNSUPPORTED",
        `payable CAM write call requires transaction value: ${call.function}`,
      )
    }

    const value = evmUint256Value(call.value)
    if (value === undefined) {
      throw new CamEvmError(
        "CAM_WRITE_INVALID_VALUE",
        `CAM transaction value must be a decimal uint256: ${call.function}`,
      )
    }
    return value
  }

  if (stateMutability === "nonpayable") {
    if (call.value !== undefined) {
      throw new CamEvmError(
        "CAM_WRITE_INVALID_VALUE",
        `nonpayable CAM write call must not declare transaction value: ${call.function}`,
      )
    }
    return undefined
  }

  throw new CamEvmError(
    "CAM_WRITE_FUNCTION_NOT_MUTABLE",
    `CAM write function must be nonpayable or payable: ${call.function}`,
  )
}
