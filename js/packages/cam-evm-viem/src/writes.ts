import {
  isAddress,
} from "viem"
import type {
  AbiFunction,
  AbiParameter,
  Hex,
} from "viem"
import {
  isRecordObject,
  toInertValue,
} from "@cam/protocol"
import type { InertValue } from "@cam/protocol"

import { findUniqueAbiFunction } from "./abi-functions.ts"
import { CamEvmError } from "./errors.ts"
import type { CamContractCall, SendCamContractCallOptions, SimulateCamContractCallOptions } from "./types.ts"

type WriteRequest = {
  readonly address: CamContractCall["address"]
  readonly abi: CamContractCall["abi"]
  readonly functionName: string
  readonly args: readonly unknown[]
}

export async function sendCamContractCall({
  walletClient,
  call,
}: SendCamContractCallOptions): Promise<Hex> {
  const request = writeRequest(call)

  try {
    return await walletClient.writeContract({
      ...request,
      chain: null,
    })
  } catch (cause) {
    throw new CamEvmError("CAM_WRITE_FAILED", `failed to send CAM contract call: ${call.function}`, cause)
  }
}

export async function simulateCamContractCall({
  publicClient,
  account,
  call,
}: SimulateCamContractCallOptions): Promise<void> {
  const request = writeRequest(call)

  try {
    await publicClient.simulateContract({
      ...request,
      account,
    })
  } catch (cause) {
    throw new CamEvmError("CAM_WRITE_SIMULATION_FAILED", `CAM write simulation failed: ${call.function}`, cause)
  }
}

function writeRequest(call: CamContractCall): WriteRequest {
  const fn = findUniqueAbiFunction({
    abi: call.abi,
    functionName: call.function,
    notFoundCode: "CAM_WRITE_FUNCTION_NOT_FOUND",
    ambiguousCode: "CAM_WRITE_FUNCTION_AMBIGUOUS",
    purpose: "write",
  })

  if (fn.stateMutability !== "nonpayable" && fn.stateMutability !== "payable") {
    throw new CamEvmError("CAM_WRITE_FUNCTION_NOT_MUTABLE", `CAM write function must be payable or nonpayable: ${call.function}`)
  }

  return {
    address: call.address,
    abi: call.abi,
    functionName: call.function,
    args: normalizeWriteArgs(writeFunctionInputs(fn), call.args, call.function),
  }
}

function writeFunctionInputs(fn: AbiFunction): readonly AbiParameter[] {
  if (!Array.isArray(fn.inputs)) {
    throw new CamEvmError("CAM_WRITE_INVALID_ARGUMENT", `CAM write function ABI is missing inputs: ${fn.name}`)
  }

  return fn.inputs
}

function normalizeWriteArgs(
  inputs: readonly AbiParameter[],
  args: readonly InertValue[],
  functionName: string,
): readonly unknown[] {
  if (inputs.length !== args.length) {
    throw new CamEvmError(
      "CAM_WRITE_INVALID_ARGUMENT",
      `CAM write ${functionName} expected ${inputs.length} argument(s), got ${args.length}`,
    )
  }

  return args.map((arg, index) => normalizeWriteArg(arg, inputs[index], `${functionName}.${index}`))
}

function normalizeWriteArg(value: InertValue, parameter: AbiParameter, path: string): unknown {
  const type = parameter.type

  if (type.endsWith("[]")) {
    if (!Array.isArray(value)) {
      throw invalidArg(path, `expected array for ${type}`)
    }

    return value.map((item, index) => normalizeWriteArg(item, { ...parameter, type: type.slice(0, -2) }, `${path}.${index}`))
  }

  if (type === "string") {
    if (typeof value !== "string") throw invalidArg(path, "expected string")
    return value
  }

  if (type === "address") {
    if (typeof value !== "string" || !isAddress(value)) throw invalidArg(path, "expected address")
    return value
  }

  if (type === "bool") {
    if (typeof value !== "boolean") throw invalidArg(path, "expected bool")
    return value
  }

  const integerType = parseIntegerType(type, path)
  if (integerType !== undefined) {
    return normalizeInteger(value, path, integerType)
  }

  const fixedBytesLength = parseFixedBytesLength(type, path)
  if (type === "bytes" || fixedBytesLength !== undefined) {
    if (typeof value !== "string" || !/^0x[0-9a-fA-F]*$/.test(value)) {
      throw invalidArg(path, `expected hex bytes for ${type}`)
    }
    if (fixedBytesLength !== undefined && (value.length - 2) / 2 !== fixedBytesLength) {
      throw invalidArg(path, `expected ${fixedBytesLength} byte hex value for ${type}`)
    }
    return value
  }

  if (type === "tuple") {
    if (!isRecordObject(value)) throw invalidArg(path, "expected object for tuple")
    const components = tupleComponents(parameter, path)
    const tuple: Record<string, unknown> = {}
    for (const component of components) {
      const componentName = component.name
      if (componentName === undefined || componentName.length === 0) {
        throw invalidArg(path, "tuple components must be named")
      }
      if (!Object.hasOwn(value, componentName)) {
        throw invalidArg(path, `tuple is missing component: ${componentName}`)
      }
      tuple[componentName] = normalizeWriteArg(
        toInertValue(value[componentName]),
        component,
        `${path}.${componentName}`,
      )
    }
    return tuple
  }

  throw invalidArg(path, `unsupported ABI input type: ${type}`)
}

type IntegerType = {
  readonly bits: number
  readonly signed: boolean
}

function normalizeInteger(value: InertValue, path: string, type: IntegerType): bigint {
  if (typeof value === "number" && Number.isSafeInteger(value)) {
    return requireIntegerBounds(BigInt(value), path, type)
  }

  if (typeof value === "string" && /^-?[0-9]+$/.test(value)) {
    return requireIntegerBounds(BigInt(value), path, type)
  }

  throw invalidArg(path, "expected integer")
}

function requireIntegerBounds(value: bigint, path: string, type: IntegerType): bigint {
  const bits = BigInt(type.bits)
  const min = type.signed ? -(1n << (bits - 1n)) : 0n
  const max = type.signed ? (1n << (bits - 1n)) - 1n : (1n << bits) - 1n

  if (value < min || value > max) {
    throw invalidArg(path, `integer is out of range for ${type.signed ? "int" : "uint"}${type.bits}`)
  }

  return value
}

function parseIntegerType(type: string, path: string): IntegerType | undefined {
  const match = /^(u?)int([0-9]*)$/.exec(type)
  if (match === null) return undefined

  const bits = match[2] === "" ? 256 : Number(match[2])
  if (!Number.isInteger(bits) || bits < 8 || bits > 256 || bits % 8 !== 0) {
    throw invalidArg(path, `unsupported ABI integer type: ${type}`)
  }

  return { bits, signed: match[1] === "" }
}

function parseFixedBytesLength(type: string, path: string): number | undefined {
  const match = /^bytes([0-9]+)$/.exec(type)
  if (match === null) return undefined

  const bytes = Number(match[1])
  if (!Number.isInteger(bytes) || bytes < 1 || bytes > 32) {
    throw invalidArg(path, `unsupported ABI bytes type: ${type}`)
  }

  return bytes
}

function tupleComponents(parameter: AbiParameter, path: string): readonly AbiParameter[] {
  if (!("components" in parameter) || !Array.isArray(parameter.components)) {
    throw invalidArg(path, "tuple ABI input is missing components")
  }

  return parameter.components
}

function invalidArg(path: string, message: string): CamEvmError {
  return new CamEvmError("CAM_WRITE_INVALID_ARGUMENT", `CAM write argument ${path}: ${message}`)
}
