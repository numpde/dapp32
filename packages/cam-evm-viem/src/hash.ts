import { keccak256 } from "viem"
import type { Hex } from "viem"

import { ZERO_HASH } from "./constants.ts"
import { CamEvmError } from "./errors.ts"

export function verifyCamHash({ bytes, expectedHash, allowUnsigned = false }: VerifyCamHashOptions): void {
  if (expectedHash.toLowerCase() === ZERO_HASH) {
    if (!allowUnsigned) {
      throw new CamEvmError("CAM_HASH_UNSIGNED", "CAM hash is unsigned")
    }

    return
  }

  const actualHash = keccak256(bytes)
  if (actualHash.toLowerCase() !== expectedHash.toLowerCase()) {
    throw new CamEvmError("CAM_HASH_MISMATCH", `CAM hash mismatch: expected ${expectedHash}, got ${actualHash}`)
  }
}

type VerifyCamHashOptions = {
  readonly bytes: Uint8Array
  readonly expectedHash: Hex
  readonly allowUnsigned?: boolean
}
