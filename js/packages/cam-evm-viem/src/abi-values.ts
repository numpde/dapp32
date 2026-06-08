import type { AbiParameter } from "viem"

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
