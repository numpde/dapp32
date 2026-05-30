import type { Abi, AbiFunction } from "viem"

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
  const matches = abi.filter(
    (item): item is AbiFunction => item.type === "function" && item.name === functionName,
  )

  if (matches.length === 0) {
    throw new CamEvmError(notFoundCode, `CAM ${purpose} function not found in ABI: ${functionName}`)
  }

  if (matches.length > 1) {
    throw new CamEvmError(
      ambiguousCode,
      `CAM ${purpose} function is overloaded and not supported in CAM V1: ${functionName}`,
    )
  }

  return matches[0]
}
