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

export function isAbiAddressValue(value: unknown): value is string {
  // Address validation is structural here. Checksums are a display/review aid;
  // CAM ABI normalization only needs an exact 20-byte hex value.
  return typeof value === "string" && /^0x[0-9a-fA-F]{40}$/.test(value)
}

export function isAbiIntegerValue(value: unknown, type: AbiIntegerType): value is number | string {
  let integer: NormalizedDecimalInteger | undefined
  if (typeof value === "number" && Number.isSafeInteger(value)) {
    integer = normalizeDecimalInteger(String(value))
  } else if (typeof value === "string" && /^-?[0-9]+$/.test(value)) {
    integer = normalizeDecimalInteger(value)
  } else {
    return false
  }
  if (integer === undefined) return false

  const positiveLimit = decimalPowerOfTwo(type.signed ? type.bits - 1 : type.bits)
  if (integer.negative) {
    return type.signed && compareUnsignedDecimal(integer.digits, positiveLimit) <= 0
  }

  const max = decimalMinusOne(positiveLimit)
  return compareUnsignedDecimal(integer.digits, max) <= 0
}

export function isAbiBytesValue(value: unknown, fixedBytesLength?: number): value is string {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]*$/.test(value)) return false

  const byteLength = value.length - 2
  if (byteLength % 2 !== 0) return false
  return fixedBytesLength === undefined || byteLength / 2 === fixedBytesLength
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

type NormalizedDecimalInteger = {
  readonly negative: boolean
  readonly digits: string
}

function normalizeDecimalInteger(value: string): NormalizedDecimalInteger | undefined {
  const negative = value.startsWith("-")
  let digits = negative ? value.slice(1) : value
  if (digits.length === 0 || !/^[0-9]+$/.test(digits)) return undefined

  digits = digits.replace(/^0+/, "")
  if (digits === "") return { negative: false, digits: "0" }
  return { negative, digits }
}

const DECIMAL_POWERS_OF_TWO = new Map<number, string>()

function decimalPowerOfTwo(exponent: number): string {
  const cached = DECIMAL_POWERS_OF_TWO.get(exponent)
  if (cached !== undefined) return cached

  let value = "1"
  for (let index = 0; index < exponent; index += 1) {
    value = decimalDouble(value)
  }

  DECIMAL_POWERS_OF_TWO.set(exponent, value)
  return value
}

function decimalDouble(value: string): string {
  let carry = 0
  let result = ""
  for (let index = value.length - 1; index >= 0; index -= 1) {
    const digit = Number(value[index]) * 2 + carry
    result = String(digit % 10) + result
    carry = Math.floor(digit / 10)
  }

  return carry === 0 ? result : String(carry) + result
}

function decimalMinusOne(value: string): string {
  const digits = value.split("")
  for (let index = digits.length - 1; index >= 0; index -= 1) {
    if (digits[index] !== "0") {
      digits[index] = String(Number(digits[index]) - 1)
      break
    }
    digits[index] = "9"
  }

  const result = digits.join("").replace(/^0+/, "")
  return result === "" ? "0" : result
}

function compareUnsignedDecimal(left: string, right: string): -1 | 0 | 1 {
  if (left.length < right.length) return -1
  if (left.length > right.length) return 1
  if (left < right) return -1
  if (left > right) return 1
  return 0
}
