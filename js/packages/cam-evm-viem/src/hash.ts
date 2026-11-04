import { sha256 } from "viem"
import {
  CamResourceIntegrityError,
  verifySha256ResourceIntegrity,
} from "@cam/protocol"

import { CamEvmError } from "./errors.ts"
import type {
  CamIntegrityCheck,
  CamIntegrityWarning,
  VerifyCamHashOptions,
  VerifyCamResourceIntegrityOptions,
} from "./types.ts"

export function verifyCamHash({ bytes, expectedHash, onIntegrityWarning }: VerifyCamHashOptions): Omit<CamIntegrityCheck, "uri"> {
  const actualHash = sha256(bytes)
  if (actualHash.toLowerCase() !== expectedHash.toLowerCase()) {
    if (onIntegrityWarning !== undefined) {
      const warning: Omit<CamIntegrityWarning, "uri"> = { hashSource: "contract", status: /^0x0{64}$/i.test(expectedHash) ? "unverified" : "mismatch", expectedHash, actualHash }
      onIntegrityWarning({ ...warning })
      return warning
    }
    throw new CamEvmError("CAM_HASH_MISMATCH", `CAM hash mismatch: expected ${expectedHash}, got ${actualHash}`)
  }
  return { hashSource: "contract", status: "verified", expectedHash, actualHash }
}

export function verifyCamResourceIntegrity({
  bytes,
  integrity,
  uri,
  onIntegrityWarning,
}: VerifyCamResourceIntegrityOptions): CamIntegrityCheck {
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
        const warning: CamIntegrityWarning = { hashSource: "manifest", status: /^0x0{64}$/i.test(expectedHash) ? "unverified" : "mismatch", uri, expectedHash, actualHash }
        onIntegrityWarning({ ...warning })
        return warning
      }
      throw new CamEvmError(error.code, error.message, error)
    }

    throw error
  }
  return { hashSource: "manifest", status: "verified", uri, expectedHash: integrity.slice("sha256:".length), actualHash }
}
