import { keccak256 } from "viem"

import { CamEvmError } from "./errors.ts"
import type { VerifyCamHashOptions } from "./types.ts"

export const ZERO_HASH = "0x0000000000000000000000000000000000000000000000000000000000000000"

export function verifyCamHash({ bytes, expectedHash }: VerifyCamHashOptions): void {
  if (expectedHash === ZERO_HASH) {
    return
  }

  const actualHash = keccak256(bytes)
  if (actualHash.toLowerCase() !== expectedHash.toLowerCase()) {
    throw new CamEvmError("CAM_HASH_MISMATCH", `CAM hash mismatch: expected ${expectedHash}, got ${actualHash}`)
  }
}
