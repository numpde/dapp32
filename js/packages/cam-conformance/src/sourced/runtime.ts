import {
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
      rule: "CAM_RUNTIME_CAM_INVALID",
      resource,
      error,
    }))
  }
}
