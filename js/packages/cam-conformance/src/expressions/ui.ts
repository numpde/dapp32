import {
  UI_CONTEXT_KEYS,
} from "@cam/protocol"

import type {
  CamConformanceIssue,
} from "../issues.ts"
import type {
  ResourceDeclaration,
} from "../resources/declarations.ts"
import {
  readRawUiDocument,
} from "../ui/document.ts"
import {
  forEachString,
} from "../walk.ts"

const EXPRESSION_ROOT_RE = /^\$([A-Za-z][A-Za-z0-9_]*)/

export function validateUiExpressionRoots({
  resources,
  declarations,
  issues,
}: {
  readonly resources: ReadonlyMap<string, Uint8Array>
  readonly declarations: readonly ResourceDeclaration[]
  readonly issues: CamConformanceIssue[]
}): void {
  for (const declaration of declarations) {
    if (declaration.namespaceType !== "ui") continue
    const ui = readRawUiDocument(resources.get(declaration.uri))
    if (ui === undefined) continue

    forEachString(ui.value, "", (value, path) => validateExpressionRoot(declaration.uri, value, path, issues))
  }
}

function validateExpressionRoot(
  resource: string,
  value: string,
  path: string,
  issues: CamConformanceIssue[],
): void {
  if (!value.startsWith("$") || value.startsWith("$$")) return

  const match = EXPRESSION_ROOT_RE.exec(value)
  const root = match?.[1]
  if (root !== undefined && UI_CONTEXT_KEYS.has(root)) return
  const reportedRoot = root === undefined ? value : root

  issues.push({
    rule: "CAM_UI_EXPRESSION_ROOT_INVALID",
    severity: "error",
    resource,
    path,
    message: `UI expression root is not supported: ${reportedRoot}`,
  })
}
