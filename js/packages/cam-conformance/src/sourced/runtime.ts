import {
  CamError,
  parseCam,
} from "@cam/core"

import {
  issueFromError,
} from "../issues.ts"
import type {
  CamConformanceIssue,
} from "../issues.ts"

// Runtime compatibility is checked after granular bundle facets have inspected
// the raw root value. That keeps parseCam from swallowing more precise
// conformance diagnostics.
export function verifyRuntimeCamCompatibility({
  resource,
  root,
  issues,
}: {
  readonly resource: string
  readonly root: unknown
  readonly issues: CamConformanceIssue[]
}): void {
  try {
    parseCam(root)
  } catch (error) {
    issues.push(issueFromError({
      rule: runtimeCamRule(error),
      resource,
      error,
    }))
  }
}

function runtimeCamRule(error: unknown): string {
  if (
    error instanceof CamError
    && error.code === "CAM_INVALID_FIELD"
    && error.message.includes("field is not allowed in CAM")
  ) {
    return "CAM_MANIFEST_FIELD_UNKNOWN"
  }

  return "CAM_RUNTIME_CAM_INVALID"
}
