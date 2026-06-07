import {
  CAM_RESOURCE_MAX_BYTES,
  parseJsonBytes,
} from "@cam/protocol"

import {
  conformanceIssue,
  issueFromError,
} from "../issues.ts"
import type {
  CamConformanceIssue,
} from "../issues.ts"

type RootCamJsonResult =
  | {
      readonly ok: true
      readonly value: unknown
    }
  | {
      readonly ok: false
    }

// Root loading only establishes strict JSON bytes -> value. CAM protocol
// compatibility is checked later, so malformed CAM structure does not prevent
// resource or UI checks from reporting their own precise issues.
export function parseRootCamJson({
  resource,
  bytes,
  issues,
}: {
  readonly resource: string
  readonly bytes: Uint8Array
  readonly issues: CamConformanceIssue[]
}): RootCamJsonResult {
  if (bytes.byteLength > CAM_RESOURCE_MAX_BYTES) {
    issues.push(conformanceIssue({
      rule: "CAM_RESOURCE_TOO_LARGE",
      resource,
      message: `CAM resource is too large: ${resource} has ${bytes.byteLength} bytes; limit is ${CAM_RESOURCE_MAX_BYTES}`,
    }))
    return {
      ok: false,
    }
  }

  try {
    return {
      ok: true,
      value: parseJsonBytes(bytes),
    }
  } catch (error) {
    issues.push(issueFromError({
      rule: "CAM_ROOT_JSON_INVALID",
      resource,
      error,
    }))
    return {
      ok: false,
    }
  }
}
