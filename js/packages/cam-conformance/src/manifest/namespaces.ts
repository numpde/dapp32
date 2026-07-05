import {
  CAM_UI_NAMESPACE,
  collectCamNamespaceFacts,
  collectCamRootFact,
} from "@cam/protocol"
import type {
  CamFactDiagnostic,
  CamNamespaceFact,
} from "@cam/protocol"

import {
  conformanceIssue,
  conformanceRules,
  type CamConformanceIssue,
} from "../issues.ts"

export type DeclaredNamespace = CamNamespaceFact

const RULES = conformanceRules({
  CAM_UI_NAMESPACE_MISSING: {
    class: "A",
    reason: "CAM V1 manifests require the canonical UI namespace as the render resource root.",
  },
  CAM_NAMESPACE_DECLARATION_INVALID: {
    class: "A",
    reason: "Namespace type/name shape is static routing inventory for resources, route calls, and UI handoffs.",
  },
})

export function validateNamespaceDeclarations({
  resource,
  root,
  issues,
}: {
  readonly resource: string
  readonly root: unknown
  readonly issues: CamConformanceIssue[]
}): readonly DeclaredNamespace[] {
  const rootFact = collectCamRootFact(root, { resource }).value
  if (rootFact === undefined) return []
  const result = collectCamNamespaceFacts(rootFact)

  if (result.diagnostics.some((diagnostic) => diagnostic.code === "CAM_FACT_NAMESPACES_NOT_OBJECT")) {
    for (const diagnostic of result.diagnostics) {
      issues.push(namespaceFactDiagnosticIssue(diagnostic))
    }
    return result.namespaces
  }

  if (!Object.hasOwn(rootFact.value.namespaces as object, CAM_UI_NAMESPACE)) {
    issues.push(conformanceIssue({
      rule: RULES.CAM_UI_NAMESPACE_MISSING,
      resource,
      path: `namespaces.${CAM_UI_NAMESPACE}`,
      message: "CAM bundle must declare a ui namespace",
    }))
  }
  for (const diagnostic of result.diagnostics) {
    issues.push(namespaceFactDiagnosticIssue(diagnostic))
  }

  return result.namespaces
}

function namespaceFactDiagnosticIssue(diagnostic: CamFactDiagnostic): CamConformanceIssue {
  return conformanceIssue({
    rule: RULES.CAM_NAMESPACE_DECLARATION_INVALID,
    resource: diagnostic.resource,
    path: diagnostic.path,
    message: diagnostic.message,
  })
}
