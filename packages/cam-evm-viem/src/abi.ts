import type { Abi } from "viem"

import { CamEvmError } from "./errors.ts"
import { parseJsonBytes } from "./json.ts"

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
  const value = parseJsonBytes(bytes, "CAM_ABI_INVALID", `CAM ABI is not valid JSON: ${uri}`)

  if (!Array.isArray(value)) {
    throw new CamEvmError("CAM_ABI_INVALID", `CAM ABI must be a JSON array: ${uri}`)
  }

  return value as Abi
}
