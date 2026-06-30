import { keccak256, sha256 } from "viem"
import {
  CamResourceIntegrityError,
  verifySha256ResourceIntegrity,
} from "@cam/protocol"

import { ZERO_HASH } from "./constants.ts"
import { CamEvmError } from "./errors.ts"
import type {
  VerifyCamHashOptions,
  VerifyCamResourceIntegrityOptions,
} from "./types.ts"

export function assertCamHashLoadAllowed({
  expectedHash,
  allowUnsigned,
}: {
  readonly expectedHash: VerifyCamHashOptions["expectedHash"]
  readonly allowUnsigned: VerifyCamHashOptions["allowUnsigned"]
}): void {
  if (expectedHash.toLowerCase() === ZERO_HASH && !allowUnsigned) {
    throw new CamEvmError("CAM_HASH_UNSIGNED", "CAM hash is unsigned")
  }
}

export function verifyCamHash({ bytes, expectedHash, allowUnsigned }: VerifyCamHashOptions): void {
  assertCamHashLoadAllowed({ expectedHash, allowUnsigned })

  if (expectedHash.toLowerCase() === ZERO_HASH) {
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
  try {
    verifySha256ResourceIntegrity({
      actualHash: sha256(bytes),
      integrity,
      uri,
    })
  } catch (error) {
    if (error instanceof CamResourceIntegrityError) {
      throw new CamEvmError(error.code, error.message, error)
    }

    throw error
  }
}
