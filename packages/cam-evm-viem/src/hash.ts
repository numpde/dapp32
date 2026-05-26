import { keccak256 } from "viem"

import { ZERO_HASH } from "./constants.ts"
import { CamEvmError } from "./errors.ts"
import type { VerifyCamHashOptions } from "./types.ts"

export function verifyCamHash({ bytes, expectedHash }: VerifyCamHashOptions): void {
  // TODO(silent-defaults): ZERO_HASH intentionally means "unsigned CAM", but
  // it also disables integrity checking silently for callers that pass the
  // zero value by accident. Consider making unsigned mode explicit in options.
  if (expectedHash.toLowerCase() === ZERO_HASH) {
    return
  }

  const actualHash = keccak256(bytes)
  if (actualHash.toLowerCase() !== expectedHash.toLowerCase()) {
    throw new CamEvmError("CAM_HASH_MISMATCH", `CAM hash mismatch: expected ${expectedHash}, got ${actualHash}`)
  }
}
