import {
  isRecordObject,
} from "@cam/protocol"

import type {
  CamConformanceIssue,
} from "../issues.ts"
import type {
  DeclaredNamespace,
  NamespaceType,
} from "./namespaces.ts"

const ROUTE_KINDS = new Set(["read", "write"])
const CALL_NAMESPACE_TYPES: ReadonlySet<NamespaceType> = new Set(["contract"])
const READ_THEN_NAMESPACE_TYPES: ReadonlySet<NamespaceType> = new Set(["ui"])
const WRITE_THEN_NAMESPACE_TYPES: ReadonlySet<NamespaceType> = new Set(["routes"])

export function validateRouteDeclarations({
  resource,
  root,
  namespaces,
  issues,
}: {
  readonly resource: string
  readonly root: unknown
  readonly namespaces: readonly DeclaredNamespace[]
  readonly issues: CamConformanceIssue[]
}): void {
  if (!isRecordObject(root)) return

  if (!isRecordObject(root.routes)) {
    issues.push(routeDeclarationIssue(resource, "routes", "CAM routes must be an object"))
    return
  }

  const namespaceTypes = new Map(namespaces.map((namespace) => [namespace.name, namespace.type]))
  validateEntryRoute(resource, root.entry, root.routes, issues)
  validateRoutes(resource, root.routes, namespaceTypes, issues)
}

function validateEntryRoute(
  resource: string,
  entry: unknown,
  routes: Record<string, unknown>,
  issues: CamConformanceIssue[],
): void {
  if (typeof entry !== "string" || entry.length === 0) return
  if (Object.prototype.hasOwnProperty.call(routes, entry)) return

  issues.push({
    rule: "CAM_ENTRY_ROUTE_MISSING",
    severity: "error",
    resource,
    path: "entry",
    message: `entry route does not exist: ${entry}`,
  })
}

function validateRoutes(
  resource: string,
  routes: Record<string, unknown>,
  namespaces: ReadonlyMap<string, NamespaceType>,
  issues: CamConformanceIssue[],
): void {
  for (const [routeName, route] of Object.entries(routes)) {
    if (routeName.length === 0) {
      issues.push(routeDeclarationIssue(resource, "routes", "route name must not be empty"))
      continue
    }
    if (!isRecordObject(route)) {
      issues.push(routeDeclarationIssue(resource, `routes.${routeName}`, `route must be an object: ${routeName}`))
      continue
    }
    validateRouteKind(resource, routeName, route.kind, issues)
    validateRouteInputList(resource, routeName, route.inputs, issues)
    validateRouteInvocations(resource, routeName, route, namespaces, issues)
  }
}

function validateRouteKind(
  resource: string,
  routeName: string,
  kind: unknown,
  issues: CamConformanceIssue[],
): void {
  // Route kind is protocol control flow: read routes render UI, write routes
  // continue to another route after wallet execution.
  if (typeof kind === "string" && ROUTE_KINDS.has(kind)) return

  issues.push({
    rule: "CAM_ROUTE_KIND_INVALID",
    severity: "error",
    resource,
    path: `routes.${routeName}.kind`,
    message: `route kind must be read or write: ${routeName}`,
  })
}

function validateRouteInputList(
  resource: string,
  routeName: string,
  inputs: unknown,
  issues: CamConformanceIssue[],
): void {
  const path = `routes.${routeName}.inputs`
  if (!Array.isArray(inputs)) {
    issues.push(routeInputIssue(resource, path, `route inputs must be an array: ${routeName}`))
    return
  }

  const seen = new Set<string>()
  for (const [index, input] of inputs.entries()) {
    const itemPath = `${path}.${index}`
    if (typeof input !== "string" || input.length === 0) {
      issues.push(routeInputIssue(resource, itemPath, `route input name must be a non-empty string: ${routeName}`))
      continue
    }

    if (seen.has(input)) {
      issues.push(routeInputIssue(resource, itemPath, `duplicate route input name: ${input}`))
    }
    seen.add(input)
  }
}

function validateRouteInvocations(
  resource: string,
  routeName: string,
  route: Record<string, unknown>,
  namespaces: ReadonlyMap<string, NamespaceType>,
  issues: CamConformanceIssue[],
): void {
  validateInvocation({
    resource,
    path: `routes.${routeName}.call`,
    invocation: route.call,
    namespaces,
    allowedTypes: CALL_NAMESPACE_TYPES,
    purpose: "route call",
    issues,
  })

  if (route.kind !== "read" && route.kind !== "write") return

  validateInvocation({
    resource,
    path: `routes.${routeName}.then`,
    invocation: route.then,
    namespaces,
    allowedTypes: route.kind === "read" ? READ_THEN_NAMESPACE_TYPES : WRITE_THEN_NAMESPACE_TYPES,
    purpose: "route continuation",
    issues,
  })
}

function validateInvocation({
  resource,
  path,
  invocation,
  namespaces,
  allowedTypes,
  purpose,
  issues,
}: {
  readonly resource: string
  readonly path: string
  readonly invocation: unknown
  readonly namespaces: ReadonlyMap<string, NamespaceType>
  readonly allowedTypes: ReadonlySet<NamespaceType>
  readonly purpose: string
  readonly issues: CamConformanceIssue[]
}): void {
  if (!isRecordObject(invocation)) {
    issues.push(routeInvocationIssue(resource, path, `${purpose} must be an object`))
    return
  }

  const functionName = invocation.function
  if (typeof functionName !== "string" || functionName.length === 0) {
    issues.push(routeInvocationIssue(resource, `${path}.function`, `${purpose} function must be a non-empty string`))
  }

  if (!isRecordObject(invocation.args)) {
    issues.push(routeInvocationIssue(resource, `${path}.args`, `${purpose} args must be an object`))
  }

  const namespace = invocation.namespace
  const namespacePath = `${path}.namespace`
  if (typeof namespace !== "string" || namespace.length === 0) {
    issues.push(routeInvocationIssue(resource, namespacePath, `${purpose} namespace must be a non-empty string`))
    return
  }

  const namespaceType = namespaces.get(namespace)
  if (namespaceType === undefined) {
    issues.push(routeInvocationIssue(resource, namespacePath, `${purpose} references unknown namespace: ${namespace}`))
    return
  }

  if (!allowedTypes.has(namespaceType)) {
    issues.push(routeInvocationIssue(
      resource,
      namespacePath,
      `${purpose} references invalid ${namespaceType} namespace: ${namespace}`,
    ))
  }
}

function routeInputIssue(resource: string, path: string, message: string): CamConformanceIssue {
  return {
    rule: "CAM_ROUTE_INPUTS_INVALID",
    severity: "error",
    resource,
    path,
    message,
  }
}

function routeDeclarationIssue(resource: string, path: string, message: string): CamConformanceIssue {
  return {
    rule: "CAM_ROUTE_DECLARATION_INVALID",
    severity: "error",
    resource,
    path,
    message,
  }
}

function routeInvocationIssue(resource: string, path: string, message: string): CamConformanceIssue {
  return {
    rule: "CAM_ROUTE_INVOCATION_INVALID",
    severity: "error",
    resource,
    path,
    message,
  }
}
