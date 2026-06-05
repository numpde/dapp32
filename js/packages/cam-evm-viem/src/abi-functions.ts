import type { Abi, AbiFunction, AbiParameter } from "viem"

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
  const functions = abi.filter((item): item is AbiFunction => item.type === "function")
  if (functionName.includes("(")) {
    return functions.filter((item) => functionSignature(item) === functionName)
  }

  return functions.filter((item) => item.name === functionName)
}

function functionSignature(fn: AbiFunction): string {
  return `${fn.name}(${fn.inputs.map(parameterType).join(",")})`
}

function parameterType(parameter: AbiParameter): string {
  const suffix = tupleArraySuffix(parameter.type)
  if (suffix === undefined) return parameter.type
  const components = "components" in parameter && Array.isArray(parameter.components)
    ? parameter.components
    : []

  return `(${components.map(parameterType).join(",")})${suffix}`
}

function tupleArraySuffix(type: string): string | undefined {
  if (type === "tuple") return ""
  if (/^tuple(\[[0-9]*\])+$/.test(type)) return type.slice("tuple".length)
  return undefined
}
