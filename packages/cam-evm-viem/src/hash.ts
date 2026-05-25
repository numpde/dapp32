import { keccak256 } from "viem"

import { ZERO_HASH } from "./constants.ts"
import { CamEvmError } from "./errors.ts"
import type { VerifyCamHashOptions } from "./types.ts"

export function verifyCamHash({ bytes, expectedHash }: VerifyCamHashOptions): void {
  if (expectedHash.toLowerCase() === ZERO_HASH) {
    return
  }

  const actualHash = keccak256(bytes)
  if (actualHash.toLowerCase() !== expectedHash.toLowerCase()) {
    throw new CamEvmError("CAM_HASH_MISMATCH", `CAM hash mismatch: expected ${expectedHash}, got ${actualHash}`)
  }
}
