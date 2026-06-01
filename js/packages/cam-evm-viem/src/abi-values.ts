import type { AbiParameter } from "viem"

export type IntegerType = {
  readonly bits: number
  readonly signed: boolean
}

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

export function isFixedArrayType(type: string): boolean {
  return /\[[0-9]+\]$/.test(type)
}

export function isTupleParameter(parameter: AbiParameter): parameter is AbiTupleParameter {
  if (parameter.type !== "tuple") {
    return false
  }

  return Array.isArray((parameter as { readonly components?: unknown }).components)
}

export function parseIntegerType(type: string): IntegerType | undefined {
  const match = /^(u?)int([0-9]*)$/.exec(type)
  if (match === null) return undefined

  const bits = match[2] === "" ? 256 : Number(match[2])
  if (!isSupportedIntegerBits(bits)) {
    throw new Error(`unsupported ABI integer type: ${type}`)
  }

  return { bits, signed: match[1] === "" }
}

export function parseFixedBytesLength(type: string): number | undefined {
  const match = /^bytes([0-9]+)$/.exec(type)
  if (match === null) return undefined

  const bytes = Number(match[1])
  if (!Number.isInteger(bytes) || bytes < 1 || bytes > 32) {
    throw new Error(`unsupported ABI bytes type: ${type}`)
  }

  return bytes
}

export function integerBounds(type: IntegerType): {
  readonly min: bigint
  readonly max: bigint
} {
  const bits = BigInt(type.bits)
  return {
    min: type.signed ? -(1n << (bits - 1n)) : 0n,
    max: type.signed ? (1n << (bits - 1n)) - 1n : (1n << bits) - 1n,
  }
}

function isSupportedIntegerBits(bits: number): boolean {
  return Number.isInteger(bits) && bits >= 8 && bits <= 256 && bits % 8 === 0
}
