import {
  parseJsonBytes,
} from "@cam/protocol"
import {
  UiError,
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
      rule: runtimeUiRule(error),
      resource,
      error,
    }))
  }
}

function runtimeUiRule(error: unknown): string {
  if (!(error instanceof UiError)) return "CAM_UI_INVALID"

  switch (error.code) {
    case "UI_NOT_OBJECT":
      return "CAM_UI_DOCUMENT_INVALID"
    case "UI_INVALID_FIELD":
      return "CAM_UI_FIELD_INVALID"
    case "UI_INVALID_EXPRESSION":
      return "CAM_UI_EXPRESSION_INVALID"
    case "UI_UNRESOLVED_VALUE":
      return "CAM_UI_VALUE_UNRESOLVED"
  }
}
