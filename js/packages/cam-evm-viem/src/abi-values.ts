import type { AbiParameter } from "viem"
import {
  abiDynamicArrayElementType,
  isAbiIntegerValue,
} from "@cam/protocol"
import type { InertValue } from "@cam/protocol"

const UINT256 = {
  bits: 256,
  signed: false,
} as const

export type EvmTransactionValue = bigint

export type AbiTupleParameter = AbiParameter & {
  readonly type: "tuple"
  readonly components: readonly AbiParameter[]
}

export function dynamicArrayElement(parameter: AbiParameter): AbiParameter | undefined {
  const elementType = abiDynamicArrayElementType(parameter.type)
  if (elementType === undefined) return undefined

  return {
    ...parameter,
    type: elementType,
  }
}

export function isTupleParameter(parameter: AbiParameter): parameter is AbiTupleParameter {
  if (parameter.type !== "tuple") {
    return false
  }

  return Array.isArray((parameter as { readonly components?: unknown }).components)
}

export function evmUint256Value(value: InertValue): EvmTransactionValue | undefined {
  if (!isAbiIntegerValue(value, UINT256)) return undefined
  return BigInt(value as string | number)
}
