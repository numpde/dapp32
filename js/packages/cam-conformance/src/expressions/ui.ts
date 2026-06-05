import {
  UI_CONTEXT_KEYS,
} from "@cam/protocol"

import {
  conformanceIssue,
  type CamConformanceIssue,
} from "../issues.ts"
import type { RawUiDocuments } from "../ui/resources.ts"
import {
  forEachString,
} from "../walk.ts"
import {
  expressionReference,
  expressionSyntaxError,
} from "./reference.ts"

export function validateUiExpressionRoots({
  uiDocuments,
  issues,
}: {
  readonly uiDocuments: RawUiDocuments
  readonly issues: CamConformanceIssue[]
}): void {
  for (const [resource, ui] of uiDocuments) {
    forEachString(ui.value, "", (value, path) => validateExpressionRoot(resource, value, path, issues))
  }
}

function validateExpressionRoot(
  resource: string,
  value: string,
  path: string,
  issues: CamConformanceIssue[],
): void {
  const syntaxError = expressionSyntaxError(value)
  if (syntaxError !== undefined) {
    issues.push(conformanceIssue({
      rule: "CAM_UI_EXPRESSION_ROOT_INVALID",
      resource,
      path,
      message: syntaxError,
    }))
    return
  }

  const reference = expressionReference(value)
  if (reference === undefined) return

  const root = reference.root
  if (UI_CONTEXT_KEYS.has(root)) return
  const reportedRoot = root.length === 0 ? value : root

  issues.push(conformanceIssue({
    rule: "CAM_UI_EXPRESSION_ROOT_INVALID",
    resource,
    path,
    message: `UI expression root is not supported: ${reportedRoot}`,
  }))
}
