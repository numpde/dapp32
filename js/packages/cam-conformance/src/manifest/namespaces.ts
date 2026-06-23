import {
  CAM_CONTRACT_NAMESPACE_PREFIX,
  CAM_ROUTES_NAMESPACE,
  CAM_UI_NAMESPACE,
  isCamNamespaceNameForType,
  isCamNamespaceType,
  isRecordObject,
} from "@cam/protocol"
import type {
  CamNamespaceType,
} from "@cam/protocol"

import {
  conformanceIssue,
  conformanceRules,
  type CamConformanceIssue,
} from "../issues.ts"

export type DeclaredNamespace = {
  readonly name: string
  readonly type: CamNamespaceType
  readonly declaration: Record<string, unknown>
}

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
  const declarations: DeclaredNamespace[] = []
  if (!isRecordObject(root)) return declarations

  const namespaces = root.namespaces
  if (!isRecordObject(namespaces)) {
    issues.push(namespaceIssue(resource, "namespaces", "CAM namespaces must be an object"))
    return declarations
  }

  if (!Object.hasOwn(namespaces, CAM_UI_NAMESPACE)) {
    issues.push(conformanceIssue({
      rule: RULES.CAM_UI_NAMESPACE_MISSING,
      resource,
      path: `namespaces.${CAM_UI_NAMESPACE}`,
      message: "CAM bundle must declare a ui namespace",
    }))
  }

  for (const [name, declaration] of Object.entries(namespaces)) {
    const declared = validateNamespaceDeclaration(resource, name, declaration, issues)
    if (declared !== undefined) {
      declarations.push(declared)
    }
  }

  return declarations
}

function validateNamespaceDeclaration(
  resource: string,
  name: string,
  declaration: unknown,
  issues: CamConformanceIssue[],
): DeclaredNamespace | undefined {
  if (name.length === 0) {
    issues.push(namespaceIssue(resource, "namespaces", "namespace name must not be empty"))
    return undefined
  }
  if (!isRecordObject(declaration)) {
    issues.push(namespaceIssue(resource, `namespaces.${name}`, `namespace must be an object: ${name}`))
    return undefined
  }

  const rawType = declaration.type
  if (typeof rawType !== "string" || rawType.length === 0) {
    issues.push(namespaceIssue(resource, `namespaces.${name}.type`, `namespace type must be a non-empty string: ${name}`))
    return undefined
  }

  if (!isCamNamespaceType(rawType)) {
    issues.push(namespaceIssue(resource, `namespaces.${name}.type`, `unknown namespace type: ${rawType}`))
    return undefined
  }

  if (!validateNamespaceName(resource, name, rawType, issues)) {
    return undefined
  }

  return {
    name,
    type: rawType,
    declaration,
  }
}

function validateNamespaceName(
  resource: string,
  name: string,
  type: CamNamespaceType,
  issues: CamConformanceIssue[],
): boolean {
  if (isCamNamespaceNameForType(name, type)) return true

  switch (type) {
    case "contract":
      issues.push(namespaceIssue(
        resource,
        `namespaces.${name}`,
        `contract namespace must be ${CAM_CONTRACT_NAMESPACE_PREFIX}<name>`,
      ))
      return false
    case "routes":
      issues.push(namespaceIssue(
        resource,
        `namespaces.${name}`,
        `routes namespace must be named ${CAM_ROUTES_NAMESPACE}`,
      ))
      return false
    case "ui":
      issues.push(namespaceIssue(
        resource,
        `namespaces.${name}`,
        `ui namespace must be named ${CAM_UI_NAMESPACE}`,
      ))
      return false
  }
}

function namespaceIssue(resource: string, path: string, message: string): CamConformanceIssue {
  return conformanceIssue({
    rule: RULES.CAM_NAMESPACE_DECLARATION_INVALID,
    resource,
    path,
    message,
  })
}
