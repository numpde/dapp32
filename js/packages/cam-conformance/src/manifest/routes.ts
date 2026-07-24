import {
  CAM_ROUTE_CALL_NAMESPACE_TYPES,
  camRouteThenNamespaceTypes,
  collectCamInvocationFact,
  collectCamRouteExpressionDiagnostics,
  collectCamRouteInputsFact,
  isCamRouteKind,
  isRecordObject,
} from "@cam/protocol"
import type {
  CamNamespaceType,
  CamFactDiagnostic,
  CamRouteKind,
  CamVersion,
} from "@cam/protocol"

import {
  conformanceIssue,
  conformanceRules,
  type CamConformanceIssue,
} from "../issues.ts"
import type {
  DeclaredNamespace,
} from "./namespaces.ts"

type DeclaredInvocation = {
  readonly namespace: string
  readonly function: string
  readonly args: Record<string, unknown>
}

export type DeclaredRoute = {
  readonly version: CamVersion
  readonly name: string
  readonly kind: CamRouteKind
  readonly inputs: readonly string[]
  readonly call: DeclaredInvocation
  readonly then: DeclaredInvocation
}

const RULES = conformanceRules({
  CAM_ENTRY_ROUTE_INVALID: {
    class: "A",
    reason: "Entry is the manifest control-flow root and must identify a start route.",
  },
  CAM_ENTRY_ROUTE_MISSING: {
    class: "A",
    reason: "Entry-to-route existence is a pure manifest join.",
  },
  CAM_ROUTE_KIND_INVALID: {
    class: "A",
    reason: "Route kind selects the static read-to-UI or write-to-route continuation contract.",
  },
  CAM_ROUTE_INPUTS_INVALID: {
    class: "A",
    reason: "Route inputs define public expression names available before execution.",
  },
  CAM_ROUTE_DECLARATION_INVALID: {
    class: "A",
    reason: "Route inventory is the manifest control-flow graph for route/UI/ABI joins.",
  },
  CAM_ROUTE_INVOCATION_INVALID: {
    class: "A",
    reason: "Invocation namespace/function/arg shape is a static call contract.",
  },
  CAM_ROUTE_EXPRESSION_INVALID: {
    class: "A",
    reason: "Route expression roots and declared-input references are known from the route declaration.",
  },
})

export function validateRouteDeclarations({
  resource,
  root,
  version,
  namespaces,
  issues,
}: {
  readonly resource: string
  readonly root: unknown
  readonly version: CamVersion
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
  return validateRoutes(resource, root.routes, namespaceTypes, version, issues)
}

function validateEntryRoute(
  resource: string,
  entry: unknown,
  routes: Record<string, unknown>,
  issues: CamConformanceIssue[],
): void {
  if (typeof entry !== "string" || entry.length === 0) {
    issues.push(conformanceIssue({
      rule: RULES.CAM_ENTRY_ROUTE_INVALID,
      resource,
      path: "entry",
      message: "CAM entry route must be a non-empty string",
    }))
    return
  }
  if (Object.hasOwn(routes, entry)) return

  issues.push(conformanceIssue({
    rule: RULES.CAM_ENTRY_ROUTE_MISSING,
    resource,
    path: "entry",
    message: `entry route does not exist: ${entry}`,
  }))
}

function validateRoutes(
  resource: string,
  routes: Record<string, unknown>,
  namespaces: ReadonlyMap<string, CamNamespaceType>,
  version: CamVersion,
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
        version,
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
): CamRouteKind | undefined {
  // Route kind is protocol control flow: read routes render UI, write routes
  // continue to another route after the write boundary.
  if (isCamRouteKind(kind)) return kind

  issues.push(conformanceIssue({
    rule: RULES.CAM_ROUTE_KIND_INVALID,
    resource,
    path: `routes.${routeName}.kind`,
    message: `route kind must be read or write: ${routeName}`,
  }))
  return undefined
}

function validateRouteInputList(
  resource: string,
  routeName: string,
  inputs: unknown,
  issues: CamConformanceIssue[],
): readonly string[] | undefined {
  const path = `routes.${routeName}.inputs`
  const result = collectCamRouteInputsFact({
    resource,
    path,
    routeName,
    inputs,
  })
  for (const diagnostic of result.diagnostics) {
    issues.push(routeInputFactDiagnosticIssue(diagnostic))
  }

  return result.value?.inputs
}

function validateRouteInvocations(
  resource: string,
  routeName: string,
  route: Record<string, unknown>,
  namespaces: ReadonlyMap<string, CamNamespaceType>,
  issues: CamConformanceIssue[],
): { readonly call: DeclaredInvocation, readonly then: DeclaredInvocation } | undefined {
  const call = validateInvocation({
    resource,
    path: `routes.${routeName}.call`,
    invocation: route.call,
    namespaces,
    allowedTypes: CAM_ROUTE_CALL_NAMESPACE_TYPES,
    purpose: "route call",
    issues,
  })

  if (route.kind !== "read" && route.kind !== "write") return undefined

  const then = validateInvocation({
    resource,
    path: `routes.${routeName}.then`,
    invocation: route.then,
    namespaces,
    allowedTypes: camRouteThenNamespaceTypes(route.kind),
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
  readonly kind: CamRouteKind
  readonly callArgs: Record<string, unknown>
  readonly thenArgs: Record<string, unknown>
  readonly issues: CamConformanceIssue[]
}): void {
  const declaredInputs = new Set(inputs)
  for (const diagnostic of collectCamRouteExpressionDiagnostics({
    resource,
    value: callArgs,
    path: `routes.${routeName}.call.args`,
    declaredInputs,
    allowOutputs: false,
    outputUnavailableMessage: "route call arguments cannot reference outputs before the call runs",
  })) {
    issues.push(routeExpressionFactDiagnosticIssue(diagnostic))
  }

  for (const diagnostic of collectCamRouteExpressionDiagnostics({
    resource,
    value: thenArgs,
    path: `routes.${routeName}.then.args`,
    declaredInputs,
    allowOutputs: kind === "read",
    outputUnavailableMessage: "write route continuations cannot reference transaction outputs",
  })) {
    issues.push(routeExpressionFactDiagnosticIssue(diagnostic))
  }
}

function routeExpressionFactDiagnosticIssue(diagnostic: CamFactDiagnostic): CamConformanceIssue {
  return conformanceIssue({
    rule: RULES.CAM_ROUTE_EXPRESSION_INVALID,
    resource: diagnostic.resource,
    path: diagnostic.path,
    message: diagnostic.message,
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
  readonly namespaces: ReadonlyMap<string, CamNamespaceType>
  readonly allowedTypes: ReadonlySet<CamNamespaceType>
  readonly purpose: string
  readonly issues: CamConformanceIssue[]
}): DeclaredInvocation | undefined {
  const result = collectCamInvocationFact({
    resource,
    path,
    invocation,
    namespaceTypes: namespaces,
    allowedNamespaceTypes: allowedTypes,
    purpose,
  })
  for (const diagnostic of result.diagnostics) {
    issues.push(invocationFactDiagnosticIssue(diagnostic))
  }

  const fact = result.value
  if (fact === undefined) return undefined
  return {
    namespace: fact.namespace,
    function: fact.function,
    args: fact.args,
  }
}

function invocationFactDiagnosticIssue(diagnostic: CamFactDiagnostic): CamConformanceIssue {
  return conformanceIssue({
    rule: RULES.CAM_ROUTE_INVOCATION_INVALID,
    resource: diagnostic.resource,
    path: diagnostic.path,
    message: diagnostic.message,
  })
}

function routeInputFactDiagnosticIssue(diagnostic: CamFactDiagnostic): CamConformanceIssue {
  return conformanceIssue({
    rule: RULES.CAM_ROUTE_INPUTS_INVALID,
    resource: diagnostic.resource,
    path: diagnostic.path,
    message: diagnostic.message,
  })
}

function routeDeclarationIssue(resource: string, path: string, message: string): CamConformanceIssue {
  return conformanceIssue({
    rule: RULES.CAM_ROUTE_DECLARATION_INVALID,
    resource,
    path,
    message,
  })
}
