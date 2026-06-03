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
import {
  forEachString,
} from "../walk.ts"
import {
  expressionReference,
} from "../expressions/reference.ts"

export type RouteKind = "read" | "write"

export type DeclaredInvocation = {
  readonly namespace: string
  readonly function: string
  readonly args: Record<string, unknown>
}

export type DeclaredRoute = {
  readonly name: string
  readonly kind: RouteKind
  readonly inputs: readonly string[]
  readonly call: DeclaredInvocation
  readonly then: DeclaredInvocation
}

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
}): readonly DeclaredRoute[] {
  if (!isRecordObject(root)) return []

  if (!isRecordObject(root.routes)) {
    issues.push(routeDeclarationIssue(resource, "routes", "CAM routes must be an object"))
    return []
  }

  const namespaceTypes = new Map(namespaces.map((namespace) => [namespace.name, namespace.type]))
  validateEntryRoute(resource, root.entry, root.routes, issues)
  return validateRoutes(resource, root.routes, namespaceTypes, issues)
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
): readonly DeclaredRoute[] {
  const declaredRoutes: DeclaredRoute[] = []
  for (const [routeName, route] of Object.entries(routes)) {
    if (routeName.length === 0) {
      issues.push(routeDeclarationIssue(resource, "routes", "route name must not be empty"))
      continue
    }
    if (!isRecordObject(route)) {
      issues.push(routeDeclarationIssue(resource, `routes.${routeName}`, `route must be an object: ${routeName}`))
      continue
    }
    const kind = validateRouteKind(resource, routeName, route.kind, issues)
    const inputs = validateRouteInputList(resource, routeName, route.inputs, issues)
    const invocations = validateRouteInvocations(resource, routeName, route, namespaces, issues)
    if (kind !== undefined && inputs !== undefined && invocations !== undefined) {
      validateRouteExpressionReferences({
        resource,
        routeName,
        inputs,
        kind,
        callArgs: invocations.call.args,
        thenArgs: invocations.then.args,
        issues,
      })
      declaredRoutes.push({
        name: routeName,
        kind,
        inputs,
        call: invocations.call,
        then: invocations.then,
      })
    }
  }

  return declaredRoutes
}

function validateRouteKind(
  resource: string,
  routeName: string,
  kind: unknown,
  issues: CamConformanceIssue[],
): RouteKind | undefined {
  // Route kind is protocol control flow: read routes render UI, write routes
  // continue to another route after wallet execution.
  if (kind === "read" || kind === "write") return kind

  issues.push({
    rule: "CAM_ROUTE_KIND_INVALID",
    severity: "error",
    resource,
    path: `routes.${routeName}.kind`,
    message: `route kind must be read or write: ${routeName}`,
  })
  return undefined
}

function validateRouteInputList(
  resource: string,
  routeName: string,
  inputs: unknown,
  issues: CamConformanceIssue[],
): readonly string[] | undefined {
  const path = `routes.${routeName}.inputs`
  if (!Array.isArray(inputs)) {
    issues.push(routeInputIssue(resource, path, `route inputs must be an array: ${routeName}`))
    return undefined
  }

  const seen = new Set<string>()
  const validatedInputs: string[] = []
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
    validatedInputs.push(input)
  }

  if (validatedInputs.length !== inputs.length || seen.size !== inputs.length) {
    return undefined
  }

  return validatedInputs
}

function validateRouteInvocations(
  resource: string,
  routeName: string,
  route: Record<string, unknown>,
  namespaces: ReadonlyMap<string, NamespaceType>,
  issues: CamConformanceIssue[],
): { readonly call: DeclaredInvocation, readonly then: DeclaredInvocation } | undefined {
  const call = validateInvocation({
    resource,
    path: `routes.${routeName}.call`,
    invocation: route.call,
    namespaces,
    allowedTypes: CALL_NAMESPACE_TYPES,
    purpose: "route call",
    issues,
  })

  if (route.kind !== "read" && route.kind !== "write") return undefined

  const then = validateInvocation({
    resource,
    path: `routes.${routeName}.then`,
    invocation: route.then,
    namespaces,
    allowedTypes: route.kind === "read" ? READ_THEN_NAMESPACE_TYPES : WRITE_THEN_NAMESPACE_TYPES,
    purpose: "route continuation",
    issues,
  })

  if (call === undefined || then === undefined) return undefined
  return { call, then }
}

function validateRouteExpressionReferences({
  resource,
  routeName,
  inputs,
  kind,
  callArgs,
  thenArgs,
  issues,
}: {
  readonly resource: string
  readonly routeName: string
  readonly inputs: readonly string[]
  readonly kind: RouteKind
  readonly callArgs: Record<string, unknown>
  readonly thenArgs: Record<string, unknown>
  readonly issues: CamConformanceIssue[]
}): void {
  const declaredInputs = new Set(inputs)
  forEachString(callArgs, `routes.${routeName}.call.args`, (value, path) => {
    validateRouteExpressionString({
      resource,
      path,
      value,
      declaredInputs,
      allowOutputs: false,
      outputErrorMessage: "route call arguments cannot reference outputs before the call runs",
      issues,
    })
  })
  forEachString(thenArgs, `routes.${routeName}.then.args`, (value, path) => {
    validateRouteExpressionString({
      resource,
      path,
      value,
      declaredInputs,
      allowOutputs: kind === "read",
      outputErrorMessage: "write route continuations cannot reference transaction outputs",
      issues,
    })
  })
}

function validateRouteExpressionString({
  resource,
  path,
  value,
  declaredInputs,
  allowOutputs,
  outputErrorMessage,
  issues,
}: {
  readonly resource: string
  readonly path: string
  readonly value: string
  readonly declaredInputs: ReadonlySet<string>
  readonly allowOutputs: boolean
  readonly outputErrorMessage: string
  readonly issues: CamConformanceIssue[]
}): void {
  const reference = expressionReference(value)
  if (reference === undefined) return

  const { root, firstSegment } = reference
  if (
    root === "inputs"
    && firstSegment !== undefined
    && firstSegment.length > 0
    && !declaredInputs.has(firstSegment)
  ) {
    issues.push(routeExpressionIssue(resource, path, `route expression references undeclared input: ${firstSegment}`))
  }

  if (root === "outputs" && !allowOutputs) {
    issues.push(routeExpressionIssue(resource, path, outputErrorMessage))
  }
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
}): DeclaredInvocation | undefined {
  if (!isRecordObject(invocation)) {
    issues.push(routeInvocationIssue(resource, path, `${purpose} must be an object`))
    return undefined
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
    return undefined
  }

  const namespaceType = namespaces.get(namespace)
  if (namespaceType === undefined) {
    issues.push(routeInvocationIssue(resource, namespacePath, `${purpose} references unknown namespace: ${namespace}`))
    return undefined
  }

  if (!allowedTypes.has(namespaceType)) {
    issues.push(routeInvocationIssue(
      resource,
      namespacePath,
      `${purpose} references invalid ${namespaceType} namespace: ${namespace}`,
    ))
  }

  if (typeof functionName !== "string" || functionName.length === 0) return undefined
  if (!isRecordObject(invocation.args)) return undefined
  if (!allowedTypes.has(namespaceType)) return undefined

  return {
    namespace,
    function: functionName,
    args: invocation.args,
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

function routeExpressionIssue(resource: string, path: string, message: string): CamConformanceIssue {
  return {
    rule: "CAM_ROUTE_EXPRESSION_INVALID",
    severity: "error",
    resource,
    path,
    message,
  }
}
