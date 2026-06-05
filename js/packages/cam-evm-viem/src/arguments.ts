import { isAddress } from "viem"
import type { AbiFunction, AbiParameter } from "viem"
import {
  isRecordObject,
  parseAbiFixedBytesLength,
  parseAbiIntegerType,
  toInertValue,
} from "@cam/protocol"
import type { AbiIntegerType, InertValue } from "@cam/protocol"

import {
  dynamicArrayElement,
  integerBounds,
} from "./abi-values.ts"
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

  const element = dynamicArrayElement(parameter)
  if (element !== undefined) {
    if (!Array.isArray(value)) {
      throw invalidArg(errorCode, path, "", `expected array for ${type}`)
    }

    return value.map((item, index) =>
      normalizeAbiArg(item, element, `${path}.${index}`, errorCode),
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

  try {
    const integerType = parseAbiIntegerType(type)
    if (integerType !== undefined) {
      return normalizeInteger(value, errorCode, path, integerType)
    }
  } catch (cause) {
    throw invalidArg(errorCode, path, "", cause instanceof Error ? cause.message : String(cause))
  }

  let fixedBytesLength: number | undefined
  try {
    fixedBytesLength = parseAbiFixedBytesLength(type)
  } catch (cause) {
    throw invalidArg(errorCode, path, "", cause instanceof Error ? cause.message : String(cause))
  }
  if (type === "bytes" || fixedBytesLength !== undefined) {
    if (typeof value !== "string" || !/^0x[0-9a-fA-F]*$/.test(value)) {
      throw invalidArg(errorCode, path, "", `expected hex bytes for ${type}`)
    }
    if ((value.length - 2) % 2 !== 0) {
      throw invalidArg(errorCode, path, "", `expected whole-byte hex value for ${type}`)
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

function normalizeInteger(value: InertValue, errorCode: ArgumentErrorCode, path: string, type: AbiIntegerType): bigint {
  if (typeof value === "number" && Number.isSafeInteger(value)) {
    return requireIntegerBounds(value, errorCode, path, type)
  }

  if (typeof value === "string" && /^-?[0-9]+$/.test(value)) {
    return requireIntegerBounds(BigInt(value), errorCode, path, type)
  }

  throw invalidArg(errorCode, path, "", "expected integer")
}

function requireIntegerBounds(value: bigint | number, errorCode: ArgumentErrorCode, path: string, type: AbiIntegerType): bigint {
  const bigintValue = typeof value === "bigint" ? value : BigInt(value)
  const { min, max } = integerBounds(type)

  if (bigintValue < min || bigintValue > max) {
    throw invalidArg(errorCode, path, "", `integer is out of range for ${type.signed ? "int" : "uint"}${type.bits}`)
  }

  return bigintValue
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
