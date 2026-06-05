export type AbiIntegerType = {
  readonly bits: number
  readonly signed: boolean
}

export type AbiScalarKind = "address" | "bool" | "bytes" | "fixed-bytes" | "integer" | "string"

// CAM only supports ABI types whose decoded values can be normalized into
// inert protocol data without Solidity-specific runtime machinery.
export function isSupportedAbiScalarType(type: string): boolean {
  return abiScalarKind(type) !== undefined
}

export function abiScalarKind(type: string): AbiScalarKind | undefined {
  if (type === "string" || type === "address" || type === "bool" || type === "bytes") return type
  if (supportedAbiIntegerType(type) !== undefined) return "integer"
  if (supportedAbiFixedBytesLength(type) !== undefined) return "fixed-bytes"
  return undefined
}

export function parseAbiIntegerType(type: string): AbiIntegerType | undefined {
  const parsed = supportedAbiIntegerType(type)
  if (parsed !== undefined) return parsed
  if (/^(u?)int([0-9]*)$/.test(type)) {
    throw new Error(`unsupported ABI integer type: ${type}`)
  }

  return undefined
}

export function parseAbiFixedBytesLength(type: string): number | undefined {
  const parsed = supportedAbiFixedBytesLength(type)
  if (parsed !== undefined) return parsed
  if (/^bytes([0-9]+)$/.test(type)) {
    throw new Error(`unsupported ABI bytes type: ${type}`)
  }

  return undefined
}

export function isFixedAbiArrayType(type: string): boolean {
  return /\[[0-9]+\]$/.test(type)
}

function isSupportedAbiIntegerBits(bits: number): boolean {
  return Number.isInteger(bits) && bits >= 8 && bits <= 256 && bits % 8 === 0
}

function supportedAbiIntegerType(type: string): AbiIntegerType | undefined {
  const match = /^(u?)int([0-9]*)$/.exec(type)
  if (match === null) return undefined

  const bits = match[2] === "" ? 256 : Number(match[2])
  return isSupportedAbiIntegerBits(bits) ? { bits, signed: match[1] === "" } : undefined
}

function supportedAbiFixedBytesLength(type: string): number | undefined {
  const match = /^bytes([0-9]+)$/.exec(type)
  if (match === null) return undefined

  const bytes = Number(match[1])
  return Number.isInteger(bytes) && bytes >= 1 && bytes <= 32 ? bytes : undefined
}
