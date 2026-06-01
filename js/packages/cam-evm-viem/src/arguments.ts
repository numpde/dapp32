import { isAddress } from "viem"
import type { AbiFunction, AbiParameter } from "viem"
import {
  isRecordObject,
  toInertValue,
} from "@cam/protocol"
import type { InertValue } from "@cam/protocol"

import { CamEvmError } from "./errors.ts"

type ArgumentErrorCode = "CAM_ROUTE_INVALID_ARGUMENT" | "CAM_WRITE_INVALID_ARGUMENT"

export function abiFunctionInputs(
  fn: AbiFunction,
  errorCode: ArgumentErrorCode,
): readonly AbiParameter[] {
  if (!Array.isArray(fn.inputs)) {
    throw new CamEvmError(errorCode, `CAM function ABI is missing inputs: ${fn.name}`)
  }

  return fn.inputs
}

export function normalizeAbiArgs({
  inputs,
  args,
  functionName,
  errorCode,
}: {
  readonly inputs: readonly AbiParameter[]
  readonly args: Record<string, InertValue>
  readonly functionName: string
  readonly errorCode: ArgumentErrorCode
}): readonly unknown[] {
  // CAM manifests use named arguments so reviewers can audit intent. EVM calls
  // are positional, so this is the single boundary that checks names and orders
  // them exactly as the ABI requires.
  const expectedNames = new Set<string>()

  for (const input of inputs) {
    const name = input.name
    if (name === undefined || name.length === 0) {
      throw invalidArg(errorCode, functionName, "", "ABI inputs must be named")
    }
    expectedNames.add(name)
  }

  for (const name of Object.keys(args)) {
    if (!expectedNames.has(name)) {
      throw invalidArg(errorCode, functionName, name, "unexpected argument")
    }
  }

  return inputs.map((input) => {
    const name = input.name
    if (name === undefined || name.length === 0) {
      throw invalidArg(errorCode, functionName, "", "ABI inputs must be named")
    }
    if (!Object.hasOwn(args, name)) {
      throw invalidArg(errorCode, functionName, name, "missing argument")
    }

    return normalizeAbiArg(args[name], input, `${functionName}.${name}`, errorCode)
  })
}

function normalizeAbiArg(
  value: InertValue,
  parameter: AbiParameter,
  path: string,
  errorCode: ArgumentErrorCode,
): unknown {
  const type = parameter.type

  if (type.endsWith("[]")) {
    if (!Array.isArray(value)) {
      throw invalidArg(errorCode, path, "", `expected array for ${type}`)
    }

    return value.map((item, index) =>
      normalizeAbiArg(item, { ...parameter, type: type.slice(0, -2) }, `${path}.${index}`, errorCode),
    )
  }

  if (type === "string") {
    if (typeof value !== "string") throw invalidArg(errorCode, path, "", "expected string")
    return value
  }

  if (type === "address") {
    if (typeof value !== "string" || !isAddress(value)) throw invalidArg(errorCode, path, "", "expected address")
    return value
  }

  if (type === "bool") {
    if (typeof value !== "boolean") throw invalidArg(errorCode, path, "", "expected bool")
    return value
  }

  const integerType = parseIntegerType(type, errorCode, path)
  if (integerType !== undefined) {
    return normalizeInteger(value, errorCode, path, integerType)
  }

  const fixedBytesLength = parseFixedBytesLength(type, errorCode, path)
  if (type === "bytes" || fixedBytesLength !== undefined) {
    if (typeof value !== "string" || !/^0x[0-9a-fA-F]*$/.test(value)) {
      throw invalidArg(errorCode, path, "", `expected hex bytes for ${type}`)
    }
    if (fixedBytesLength !== undefined && (value.length - 2) / 2 !== fixedBytesLength) {
      throw invalidArg(errorCode, path, "", `expected ${fixedBytesLength} byte hex value for ${type}`)
    }
    return value
  }

  if (type === "tuple") {
    if (!isRecordObject(value)) throw invalidArg(errorCode, path, "", "expected object for tuple")
    const components = tupleComponents(parameter, errorCode, path)
    const tuple: Record<string, unknown> = {}
    for (const component of components) {
      const componentName = component.name
      if (componentName === undefined || componentName.length === 0) {
        throw invalidArg(errorCode, path, "", "tuple components must be named")
      }
      if (!Object.hasOwn(value, componentName)) {
        throw invalidArg(errorCode, path, componentName, "tuple is missing component")
      }
      tuple[componentName] = normalizeAbiArg(
        toInertValue(value[componentName]),
        component,
        `${path}.${componentName}`,
        errorCode,
      )
    }
    return tuple
  }

  throw invalidArg(errorCode, path, "", `unsupported ABI input type: ${type}`)
}

type IntegerType = {
  readonly bits: number
  readonly signed: boolean
}

function normalizeInteger(value: InertValue, errorCode: ArgumentErrorCode, path: string, type: IntegerType): bigint {
  if (typeof value === "number" && Number.isSafeInteger(value)) {
    return requireIntegerBounds(value, errorCode, path, type)
  }

  if (typeof value === "string" && /^-?[0-9]+$/.test(value)) {
    return requireIntegerBounds(BigInt(value), errorCode, path, type)
  }

  throw invalidArg(errorCode, path, "", "expected integer")
}

function requireIntegerBounds(
  value: bigint | number,
  errorCode: ArgumentErrorCode,
  path: string,
  type: IntegerType,
): bigint {
  const bigintValue = typeof value === "bigint" ? value : BigInt(value)
  const bits = BigInt(type.bits)
  const min = type.signed ? -(1n << (bits - 1n)) : 0n
  const max = type.signed ? (1n << (bits - 1n)) - 1n : (1n << bits) - 1n

  if (bigintValue < min || bigintValue > max) {
    throw invalidArg(errorCode, path, "", `integer is out of range for ${type.signed ? "int" : "uint"}${type.bits}`)
  }

  return bigintValue
}

function parseIntegerType(type: string, errorCode: ArgumentErrorCode, path: string): IntegerType | undefined {
  const match = /^(u?)int([0-9]*)$/.exec(type)
  if (match === null) return undefined

  const bits = match[2] === "" ? 256 : Number(match[2])
  if (!Number.isInteger(bits) || bits < 8 || bits > 256 || bits % 8 !== 0) {
    throw invalidArg(errorCode, path, "", `unsupported ABI integer type: ${type}`)
  }

  return { bits, signed: match[1] === "" }
}

function parseFixedBytesLength(type: string, errorCode: ArgumentErrorCode, path: string): number | undefined {
  const match = /^bytes([0-9]+)$/.exec(type)
  if (match === null) return undefined

  const bytes = Number(match[1])
  if (!Number.isInteger(bytes) || bytes < 1 || bytes > 32) {
    throw invalidArg(errorCode, path, "", `unsupported ABI bytes type: ${type}`)
  }

  return bytes
}

function tupleComponents(
  parameter: AbiParameter,
  errorCode: ArgumentErrorCode,
  path: string,
): readonly AbiParameter[] {
  if (!("components" in parameter) || !Array.isArray(parameter.components)) {
    throw invalidArg(errorCode, path, "", "tuple ABI input is missing components")
  }

  return parameter.components
}

function invalidArg(
  code: ArgumentErrorCode,
  path: string,
  name: string,
  message: string,
): CamEvmError {
  const suffix = name === "" ? "" : `.${name}`
  return new CamEvmError(code, `CAM ABI argument ${path}${suffix}: ${message}`)
}
