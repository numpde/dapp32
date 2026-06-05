import type { AbiParameter } from "viem"
import type {
  AbiIntegerType,
} from "@cam/protocol"

export type AbiTupleParameter = AbiParameter & {
  readonly type: "tuple"
  readonly components: readonly AbiParameter[]
}

export function dynamicArrayElement(parameter: AbiParameter): AbiParameter | undefined {
  if (!parameter.type.endsWith("[]")) {
    return undefined
  }

  return {
    ...parameter,
    type: parameter.type.slice(0, -2),
  }
}

export function isTupleParameter(parameter: AbiParameter): parameter is AbiTupleParameter {
  if (parameter.type !== "tuple") {
    return false
  }

  return Array.isArray((parameter as { readonly components?: unknown }).components)
}

export function integerBounds(type: AbiIntegerType): {
  readonly min: bigint
  readonly max: bigint
} {
  const bits = BigInt(type.bits)
  return {
    min: type.signed ? -(1n << (bits - 1n)) : 0n,
    max: type.signed ? (1n << (bits - 1n)) - 1n : (1n << bits) - 1n,
  }
}
