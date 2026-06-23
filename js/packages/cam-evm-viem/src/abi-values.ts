import type { AbiParameter } from "viem"
import {
  abiDynamicArrayElementType,
} from "@cam/protocol"

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
