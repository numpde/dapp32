import type { Abi, AbiFunction, AbiParameter } from "viem"
import {
  isFixedAbiArrayType,
  isRecordObject,
  isSupportedAbiScalarType,
  parseAbiFixedBytesLength,
  parseAbiIntegerType,
  parseJsonBytes,
} from "@cam/protocol"

import {
  dynamicArrayElement,
} from "./abi-values.ts"
import { CamEvmError } from "./errors.ts"

export const CAM_ROOT_FUNCTIONS = {
  camURI: "camURI",
  camHash: "camHash",
  contractAddress: "contractAddress",
  supportsInterface: "supportsInterface",
} as const

// type(ICamApp).interfaceId from ICamApp.sol. Solidity does not include the
// inherited IERC165 function in the child interface id; ERC-165 itself is
// checked separately with 0x01ffc9a7 if needed.
export const ICAM_APP_INTERFACE_ID = "0x03625ff6"

export const camRootAbi = [
  {
    type: "function",
    name: CAM_ROOT_FUNCTIONS.supportsInterface,
    stateMutability: "view",
    inputs: [{ name: "interfaceId", type: "bytes4" }],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: CAM_ROOT_FUNCTIONS.camURI,
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "string" }],
  },
  {
    type: "function",
    name: CAM_ROOT_FUNCTIONS.camHash,
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "bytes32" }],
  },
  {
    type: "function",
    name: CAM_ROOT_FUNCTIONS.contractAddress,
    stateMutability: "view",
    inputs: [{ name: "contractName", type: "string" }],
    outputs: [{ name: "", type: "address" }],
  },
] as const

export function parseAbiBytes(bytes: Uint8Array, uri: string): Abi {
  let value: unknown
  try {
    value = parseJsonBytes(bytes)
  } catch (cause) {
    throw new CamEvmError("CAM_ABI_INVALID", `CAM ABI is not valid JSON: ${uri}`, cause)
  }

  if (!Array.isArray(value)) {
    throw new CamEvmError("CAM_ABI_INVALID", `CAM ABI must be a JSON array: ${uri}`)
  }

  const signatures = new Set<string>()
  for (let index = 0; index < value.length; index++) {
    const item = value[index]
    validateAbiItem(item, `${uri}.${index}`)
    if (isRecordObject(item) && item.type === "function") {
      const signature = abiFunctionSignature(item as AbiFunction)
      if (signatures.has(signature)) {
        throw new CamEvmError("CAM_ABI_INVALID", `CAM ABI contains duplicate function signature: ${signature}`)
      }
      signatures.add(signature)
    }
  }

  return value as Abi
}

export function abiFunctionSignature(fn: AbiFunction): string {
  return `${fn.name}(${fn.inputs.map(parameterType).join(",")})`
}

function validateAbiItem(item: unknown, path: string): void {
  if (!isRecordObject(item)) {
    throw new CamEvmError("CAM_ABI_INVALID", `CAM ABI item must be an object: ${path}`)
  }

  if (typeof item.type !== "string" || item.type.length === 0) {
    throw new CamEvmError("CAM_ABI_INVALID", `CAM ABI item must declare a type: ${path}`)
  }

  // CAM calls only target functions. Other ABI item kinds may be present, but
  // validating every event/error variant would make this adapter a general ABI
  // linter instead of a strict caller for the shapes it executes.
  if (item.type === "function") {
    validateFunctionItem(item, path)
  }
}

function validateFunctionItem(item: Record<string, unknown>, path: string): void {
  if (typeof item.name !== "string" || item.name.length === 0) {
    throw new CamEvmError("CAM_ABI_INVALID", `CAM ABI function must declare a name: ${path}`)
  }

  if (!isStateMutability(item.stateMutability)) {
    throw new CamEvmError("CAM_ABI_INVALID", `CAM ABI function must declare stateMutability: ${path}`)
  }

  validateAbiParameters(item.inputs, `${path}.inputs`)
  validateAbiParameters(item.outputs, `${path}.outputs`)
}

function validateAbiParameters(value: unknown, path: string): void {
  if (!Array.isArray(value)) {
    throw new CamEvmError("CAM_ABI_INVALID", `CAM ABI parameters must be an array: ${path}`)
  }

  for (let index = 0; index < value.length; index++) {
    if (!(index in value)) {
      throw new CamEvmError("CAM_ABI_INVALID", `CAM ABI parameter must be present: ${path}.${index}`)
    }
    validateAbiParameter(value[index], `${path}.${index}`)
  }
}

function validateAbiParameter(value: unknown, path: string): void {
  if (!isRecordObject(value)) {
    throw new CamEvmError("CAM_ABI_INVALID", `CAM ABI parameter must be an object: ${path}`)
  }

  if (typeof value.type !== "string" || value.type.length === 0) {
    throw new CamEvmError("CAM_ABI_INVALID", `CAM ABI parameter must declare a type: ${path}`)
  }

  const arrayElement = dynamicArrayElement(value as AbiParameter)
  if (arrayElement !== undefined) {
    validateAbiParameter(arrayElement, path)
    return
  }

  if (isFixedAbiArrayType(value.type)) {
    throw new CamEvmError("CAM_ABI_INVALID", `CAM ABI fixed-size arrays are not supported: ${path}`)
  }

  try {
    parseAbiIntegerType(value.type)
    parseAbiFixedBytesLength(value.type)
  } catch (cause) {
    throw new CamEvmError(
      "CAM_ABI_INVALID",
      `${path}: ${cause instanceof Error ? cause.message : String(cause)}`,
    )
  }

  if (value.type.startsWith("tuple")) {
    validateAbiParameters(value.components, `${path}.components`)
    return
  }

  if ("components" in value) {
    throw new CamEvmError("CAM_ABI_INVALID", `CAM ABI components require a tuple type: ${path}.components`)
  }

  if (!isSupportedAbiScalarType(value.type)) {
    throw new CamEvmError("CAM_ABI_INVALID", `CAM ABI parameter type is not supported: ${path}`)
  }
}

function isStateMutability(value: unknown): value is "pure" | "view" | "nonpayable" | "payable" {
  return value === "pure" || value === "view" || value === "nonpayable" || value === "payable"
}

function parameterType(parameter: AbiParameter): string {
  const suffix = tupleArraySuffix(parameter.type)
  if (suffix === undefined) return parameter.type
  const components = "components" in parameter && Array.isArray(parameter.components)
    ? parameter.components
    : []

  return `(${components.map(parameterType).join(",")})${suffix}`
}

function tupleArraySuffix(type: string): string | undefined {
  if (type === "tuple") return ""
  if (/^tuple(\[[0-9]*\])+$/.test(type)) return type.slice("tuple".length)
  return undefined
}
