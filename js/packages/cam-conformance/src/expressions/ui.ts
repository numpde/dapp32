import {
  collectExpressionReferences,
  UI_CONTEXT_KEYS,
} from "@cam/protocol"

import {
  conformanceIssue,
  conformanceRules,
  type CamConformanceIssue,
} from "../issues.ts"
import type { DeclaredUiDocument } from "../ui/resources.ts"

const RULES = conformanceRules({
  CAM_UI_EXPRESSION_ROOT_INVALID: {
    class: "A",
    reason: "UI expression syntax and root vocabulary are static publication properties.",
  },
})

export function validateUiExpressionRoots({
  uiDocument,
  issues,
}: {
  readonly uiDocument: DeclaredUiDocument | undefined
  readonly issues: CamConformanceIssue[]
}): void {
  if (uiDocument === undefined) return

  for (const occurrence of collectExpressionReferences(uiDocument.document.value, { numericSegments: true })) {
    if (occurrence.syntaxError !== undefined) {
      issues.push(conformanceIssue({
        rule: RULES.CAM_UI_EXPRESSION_ROOT_INVALID,
        resource: uiDocument.resource,
        path: occurrence.path,
        message: occurrence.syntaxError,
      }))
      continue
    }

    const root = occurrence.reference?.root
    if (root === undefined || UI_CONTEXT_KEYS.has(root)) continue

    issues.push(conformanceIssue({
      rule: RULES.CAM_UI_EXPRESSION_ROOT_INVALID,
      resource: uiDocument.resource,
      path: occurrence.path,
      message: `UI expression root is not supported: ${root}`,
    }))
  }
}
