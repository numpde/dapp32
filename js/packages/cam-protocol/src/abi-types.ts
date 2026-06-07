export type AbiIntegerType = {
  readonly bits: number
  readonly signed: boolean
}

export type AbiScalarKind = "address" | "bool" | "bytes" | "fixed-bytes" | "integer" | "string"

const ABI_FUNCTION_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/

// CAM only supports ABI types whose decoded values can be normalized into
// inert protocol data without Solidity-specific runtime machinery.
export function isSupportedAbiScalarType(type: string): boolean {
  return abiScalarKind(type) !== undefined
}

export function isAbiFunctionName(value: string): boolean {
  return ABI_FUNCTION_NAME_RE.test(value)
}

export function isAbiFunctionSignatureReference(value: string): boolean {
  const openParen = value.indexOf("(")
  if (openParen <= 0) return false
  if (!isAbiFunctionName(value.slice(0, openParen))) return false
  if (!value.endsWith(")") || /\s/.test(value)) return false

  let depth = 0
  for (let index = openParen; index < value.length; index++) {
    const character = value[index]
    if (character === "(") depth += 1
    if (character === ")") depth -= 1
    if (depth < 0) return false
    if (depth === 0 && index !== value.length - 1) return false
  }

  return depth === 0
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
