import {
  UI_CONTEXT_KEYS,
} from "@cam/protocol"

import {
  conformanceIssue,
  type CamConformanceIssue,
} from "../issues.ts"
import type {
  ResourceDeclaration,
} from "../resources/declarations.ts"
import {
  forEachRawUiResource,
} from "../ui/resources.ts"
import {
  forEachString,
} from "../walk.ts"
import {
  expressionReference,
} from "./reference.ts"

export function validateUiExpressionRoots({
  resources,
  declarations,
  issues,
}: {
  readonly resources: ReadonlyMap<string, Uint8Array>
  readonly declarations: readonly ResourceDeclaration[]
  readonly issues: CamConformanceIssue[]
}): void {
  forEachRawUiResource({
    resources,
    declarations,
    visit: (resource, ui) => {
      forEachString(ui.value, "", (value, path) => validateExpressionRoot(resource, value, path, issues))
    },
  })
}

function validateExpressionRoot(
  resource: string,
  value: string,
  path: string,
  issues: CamConformanceIssue[],
): void {
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
