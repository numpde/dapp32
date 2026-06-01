import { keccak256, sha256 } from "viem"

import { ZERO_HASH } from "./constants.ts"
import { CamEvmError } from "./errors.ts"
import type {
  VerifyCamHashOptions,
  VerifyCamResourceIntegrityOptions,
} from "./types.ts"

const SHA256_PREFIX = "sha256:"
const SHA256_HEX_PATTERN = /^0x[0-9a-fA-F]{64}$/

export function verifyCamHash({ bytes, expectedHash, allowUnsigned }: VerifyCamHashOptions): void {
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

export function verifyCamResourceIntegrity({
  bytes,
  integrity,
  uri,
}: VerifyCamResourceIntegrityOptions): void {
  if (!integrity.startsWith(SHA256_PREFIX)) {
    throw new CamEvmError("CAM_RESOURCE_INTEGRITY_INVALID", `CAM resource integrity must use sha256: ${uri}`)
  }

  const expectedHash = integrity.slice(SHA256_PREFIX.length)
  if (!SHA256_HEX_PATTERN.test(expectedHash)) {
    throw new CamEvmError("CAM_RESOURCE_INTEGRITY_INVALID", `CAM resource integrity is not a sha256 hex digest: ${uri}`)
  }

  const actualHash = sha256(bytes)
  if (actualHash.toLowerCase() !== expectedHash.toLowerCase()) {
    throw new CamEvmError(
      "CAM_RESOURCE_INTEGRITY_MISMATCH",
      `CAM resource integrity mismatch: expected ${integrity}, got ${SHA256_PREFIX}${actualHash}`,
    )
  }
}
