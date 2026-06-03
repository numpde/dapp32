import {
  parseJsonBytes,
} from "@cam/protocol"

import {
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
