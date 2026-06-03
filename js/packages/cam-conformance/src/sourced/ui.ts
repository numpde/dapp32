import {
  parseJsonBytes,
} from "@cam/protocol"
import {
  parseUi,
} from "@cam/screen"

import {
  issueFromError,
} from "../issues.ts"
import type {
  CamConformanceIssue,
} from "../issues.ts"

// UI readability is sourced from @cam/screen. Granular UI conformance should
// live in the UI facet; this check only proves runtime parser compatibility.
export function verifyRuntimeUiCompatibility(resource: string, bytes: Uint8Array, issues: CamConformanceIssue[]): void {
  try {
    parseUi(parseJsonBytes(bytes))
  } catch (error) {
    issues.push(issueFromError({
      rule: "CAM_UI_INVALID",
      resource,
      error,
    }))
  }
}
