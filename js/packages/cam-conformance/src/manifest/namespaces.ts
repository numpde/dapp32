import {
  CAM_CONTRACT_NAMESPACE_PREFIX,
  CAM_ROUTES_NAMESPACE,
  CAM_UI_NAMESPACE,
  isRecordObject,
} from "@cam/protocol"

import type {
  CamConformanceIssue,
} from "../issues.ts"

export type NamespaceType = "contract" | "routes" | "ui"

export type DeclaredNamespace = {
  readonly name: string
  readonly type: NamespaceType
  readonly declaration: Record<string, unknown>
}

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

  if (!Object.prototype.hasOwnProperty.call(namespaces, CAM_UI_NAMESPACE)) {
    issues.push({
      rule: "CAM_UI_RESOURCE_MISSING",
      severity: "error",
      resource,
      path: `namespaces.${CAM_UI_NAMESPACE}`,
      message: "CAM bundle must declare a ui namespace",
    })
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

  const type = namespaceType(rawType)
  if (type === undefined) {
    issues.push(namespaceIssue(resource, `namespaces.${name}.type`, `unknown namespace type: ${rawType}`))
    return undefined
  }

  if (!validateNamespaceName(resource, name, type, issues)) {
    return undefined
  }

  return {
    name,
    type,
    declaration,
  }
}

function validateNamespaceName(
  resource: string,
  name: string,
  type: NamespaceType,
  issues: CamConformanceIssue[],
): boolean {
  switch (type) {
    case "contract":
      return validateContractNamespaceName(resource, name, issues)
    case "routes":
      return validateSingletonNamespaceName(resource, name, CAM_ROUTES_NAMESPACE, "routes", issues)
    case "ui":
      return validateSingletonNamespaceName(resource, name, CAM_UI_NAMESPACE, "ui", issues)
  }
}

function namespaceType(value: unknown): NamespaceType | undefined {
  if (value === "contract" || value === "routes" || value === "ui") {
    return value
  }

  return undefined
}

function validateContractNamespaceName(
  resource: string,
  name: string,
  issues: CamConformanceIssue[],
): boolean {
  if (name.startsWith(CAM_CONTRACT_NAMESPACE_PREFIX) && name.length > CAM_CONTRACT_NAMESPACE_PREFIX.length) {
    return true
  }

  issues.push(namespaceIssue(
    resource,
    `namespaces.${name}`,
    `contract namespace must be ${CAM_CONTRACT_NAMESPACE_PREFIX}<name>`,
  ))
  return false
}

function validateSingletonNamespaceName(
  resource: string,
  actualName: string,
  expectedName: string,
  type: string,
  issues: CamConformanceIssue[],
): boolean {
  if (actualName === expectedName) return true

  issues.push(namespaceIssue(
    resource,
    `namespaces.${actualName}`,
    `${type} namespace must be named ${expectedName}`,
  ))
  return false
}

function namespaceIssue(resource: string, path: string, message: string): CamConformanceIssue {
  return {
    rule: "CAM_NAMESPACE_DECLARATION_INVALID",
    severity: "error",
    resource,
    path,
    message,
  }
}
