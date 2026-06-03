import {
  parseJsonBytes,
  UI_CONTEXT_KEYS,
} from "@cam/protocol"

import type {
  CamConformanceIssue,
} from "../issues.ts"
import type {
  ResourceDeclaration,
} from "../resources/declarations.ts"

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
    const bytes = resources.get(declaration.uri)
    if (bytes === undefined) continue

    let value: unknown
    try {
      value = parseJsonBytes(bytes)
    } catch {
      continue
    }

    walkUiStrings(declaration.uri, value, "", issues)
  }
}

function walkUiStrings(
  resource: string,
  value: unknown,
  path: string,
  issues: CamConformanceIssue[],
): void {
  if (typeof value === "string") {
    validateExpressionRoot(resource, value, path, issues)
    return
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => walkUiStrings(resource, item, joinPath(path, String(index)), issues))
    return
  }
  if (typeof value === "object" && value !== null) {
    Object.entries(value).forEach(([key, item]) => walkUiStrings(resource, item, joinPath(path, key), issues))
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

function joinPath(parent: string, child: string): string {
  return parent.length === 0 ? child : `${parent}.${child}`
}
