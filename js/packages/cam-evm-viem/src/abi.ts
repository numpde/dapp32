import type { Abi } from "viem"
import { parseJsonBytes } from "@cam/protocol"

import { CamEvmError } from "./errors.ts"

export const CAM_ROOT_FUNCTIONS = {
  camURI: "camURI",
  camHash: "camHash",
  contractAddress: "contractAddress",
} as const

export const camRootAbi = [
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

  return value as Abi
}
