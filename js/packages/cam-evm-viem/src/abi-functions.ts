import type { Abi, AbiFunction } from "viem"
import {
  abiFunctionSignature,
  isAbiFunctionName,
  isAbiFunctionSignatureReference,
  isRecordObject,
} from "@cam/protocol"

import { CamEvmError } from "./errors.ts"
import type { CamEvmErrorCode } from "./errors.ts"

export function findUniqueAbiFunction({
  abi,
  functionName,
  notFoundCode,
  ambiguousCode,
  purpose,
}: {
  readonly abi: Abi
  readonly functionName: string
  readonly notFoundCode: CamEvmErrorCode
  readonly ambiguousCode: CamEvmErrorCode
  readonly purpose: string
}): AbiFunction {
  const matches = matchingFunctions(abi, functionName)

  if (matches.length === 0) {
    throw new CamEvmError(notFoundCode, `CAM ${purpose} function not found in ABI: ${functionName}`)
  }

  if (matches.length > 1) {
    throw new CamEvmError(
      ambiguousCode,
      `CAM ${purpose} function is overloaded; use a full signature: ${functionName}`,
    )
  }

  return matches[0]
}

export function singleFunctionAbi(fn: AbiFunction): Abi {
  return [fn] as Abi
}

function matchingFunctions(abi: Abi, functionName: string): readonly AbiFunction[] {
  const functions = abi.filter(isFunctionAbiItem)
  if (isAbiFunctionSignatureReference(functionName)) {
    return functions.filter((item) => abiFunctionSignature(item) === functionName)
  }
  if (!isAbiFunctionName(functionName)) return []

  return functions.filter((item) => item.name === functionName)
}

function isFunctionAbiItem(item: unknown): item is AbiFunction {
  return isRecordObject(item) && item.type === "function"
}
