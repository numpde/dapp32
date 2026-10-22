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

export function verifyCamHash({ bytes, expectedHash, onIntegrityWarning }: VerifyCamHashOptions): void {
  const actualHash = sha256(bytes)
  if (actualHash.toLowerCase() !== expectedHash.toLowerCase()) {
    if (onIntegrityWarning !== undefined) {
      onIntegrityWarning({ status: /^0x0{64}$/i.test(expectedHash) ? "unverified" : "mismatch", expectedHash, actualHash })
      return
    }
    throw new CamEvmError("CAM_HASH_MISMATCH", `CAM hash mismatch: expected ${expectedHash}, got ${actualHash}`)
  }
}

export function verifyCamResourceIntegrity({
  bytes,
  integrity,
  uri,
  onIntegrityWarning,
}: VerifyCamResourceIntegrityOptions): void {
  const actualHash = sha256(bytes)
  try {
    verifySha256ResourceIntegrity({
      actualHash,
      integrity,
      uri,
    })
  } catch (error) {
    if (error instanceof CamResourceIntegrityError) {
      if (error.code === "CAM_RESOURCE_INTEGRITY_MISMATCH" && onIntegrityWarning !== undefined) {
        const expectedHash = integrity.slice("sha256:".length)
        onIntegrityWarning({ status: /^0x0{64}$/i.test(expectedHash) ? "unverified" : "mismatch", uri, expectedHash, actualHash })
        return
      }
      throw new CamEvmError(error.code, error.message, error)
    }

    throw error
  }
}
