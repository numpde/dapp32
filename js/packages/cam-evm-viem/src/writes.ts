import {
  isAddress,
} from "viem"
import type {
  AbiParameter,
  Hex,
} from "viem"
import {
  isRecordObject,
} from "@cam/protocol"
import type { InertValue } from "@cam/protocol"

import { findUniqueAbiFunction } from "./abi-functions.ts"
import { CamEvmError } from "./errors.ts"
import type { SendCamContractCallOptions } from "./types.ts"

export async function sendCamContractCall({
  walletClient,
  call,
}: SendCamContractCallOptions): Promise<Hex> {
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

  const args = normalizeWriteArgs(fn.inputs ?? [], call.args, call.function)

  try {
    return await walletClient.writeContract({
      address: call.address,
      abi: call.abi,
      functionName: call.function,
      args,
      chain: null,
    })
  } catch (cause) {
    throw new CamEvmError("CAM_WRITE_FAILED", `failed to send CAM contract call: ${call.function}`, cause)
  }
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
    return normalizeInteger(value, path, integerType.signed)
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
      tuple[componentName] = normalizeWriteArg(value[componentName] as InertValue, component, `${path}.${componentName}`)
    }
    return tuple
  }

  throw invalidArg(path, `unsupported ABI input type: ${type}`)
}

function normalizeInteger(value: InertValue, path: string, signed: boolean): bigint {
  if (typeof value === "number" && Number.isSafeInteger(value)) {
    return requireIntegerSign(BigInt(value), path, signed)
  }

  if (typeof value === "string" && /^-?[0-9]+$/.test(value)) {
    return requireIntegerSign(BigInt(value), path, signed)
  }

  throw invalidArg(path, "expected integer")
}

function requireIntegerSign(value: bigint, path: string, signed: boolean): bigint {
  if (!signed && value < 0n) {
    throw invalidArg(path, "expected unsigned integer")
  }

  return value
}

function parseIntegerType(type: string, path: string): { readonly signed: boolean } | undefined {
  const match = /^(u?)int([0-9]*)$/.exec(type)
  if (match === null) return undefined

  const bits = match[2] === "" ? 256 : Number(match[2])
  if (!Number.isInteger(bits) || bits < 8 || bits > 256 || bits % 8 !== 0) {
    throw invalidArg(path, `unsupported ABI integer type: ${type}`)
  }

  return { signed: match[1] === "" }
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
