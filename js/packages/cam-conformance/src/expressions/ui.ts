import {
  UI_CONTEXT_KEYS,
} from "@cam/protocol"

import {
  conformanceIssue,
  conformanceRules,
  type CamConformanceIssue,
} from "../issues.ts"
import type { DeclaredUiDocument } from "../ui/resources.ts"
import {
  forEachString,
} from "../walk.ts"
import {
  expressionReference,
  expressionSyntaxError,
} from "./reference.ts"

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

  forEachString(
    uiDocument.document.value,
    "",
    (value, path) => validateExpressionRoot(uiDocument.resource, value, path, issues),
  )
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
      rule: RULES.CAM_UI_EXPRESSION_ROOT_INVALID,
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
    rule: RULES.CAM_UI_EXPRESSION_ROOT_INVALID,
    resource,
    path,
    message: `UI expression root is not supported: ${reportedRoot}`,
  }))
}
