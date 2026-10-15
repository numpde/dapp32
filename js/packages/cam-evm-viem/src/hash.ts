import { sha256 } from "viem"
import {
  CamResourceIntegrityError,
  verifySha256ResourceIntegrity,
} from "@cam/protocol"

import { CamEvmError } from "./errors.ts"
import type {
  VerifyCamHashOptions,
  VerifyCamResourceIntegrityOptions,
} from "./types.ts"

export function verifyCamHash({ bytes, expectedHash }: VerifyCamHashOptions): void {
  const actualHash = sha256(bytes)
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
