import type { Abi } from "viem"
import { isRecordObject, parseJsonBytes } from "@cam/protocol"

import { CamEvmError } from "./errors.ts"

export const CAM_ROOT_FUNCTIONS = {
  camURI: "camURI",
  camHash: "camHash",
  contractAddress: "contractAddress",
  supportsInterface: "supportsInterface",
} as const

// type(ICamApp).interfaceId from ICamApp.sol:
// camURI() ^ camHash() ^ IERC165.supportsInterface(bytes4).
export const ICAM_APP_INTERFACE_ID = "0x029d9651"

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

  for (let index = 0; index < value.length; index++) {
    const item = value[index]
    validateAbiItem(item, `${uri}.${index}`)
  }

  return value as Abi
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

  if (/\[[0-9]+\]$/.test(value.type)) {
    throw new CamEvmError("CAM_ABI_INVALID", `CAM ABI fixed-size arrays are not supported: ${path}`)
  }

  if (value.type.startsWith("tuple")) {
    validateAbiParameters(value.components, `${path}.components`)
    return
  }

  if ("components" in value) {
    throw new CamEvmError("CAM_ABI_INVALID", `CAM ABI components require a tuple type: ${path}.components`)
  }
}

function isStateMutability(value: unknown): value is "pure" | "view" | "nonpayable" | "payable" {
  return value === "pure" || value === "view" || value === "nonpayable" || value === "payable"
}
