import {
  isRecordObject,
} from "@cam/protocol"

import {
  conformanceIssue,
  type CamConformanceIssue,
} from "../issues.ts"
import {
  abiArgValueMismatches,
  resolvedAbiFunction,
  type ContractFunctionsByNamespace,
} from "../abi/routes.ts"
import {
  knownRouteCallPathSuffix,
  knownRouteCallSource,
  knownRouteCallValue,
  UNKNOWN_ROUTE_CALL_VALUE,
} from "../expressions/known-route-call.ts"
import type {
  DeclaredRoute,
} from "../manifest/routes.ts"
import type {
  DeclaredUiNode,
} from "../ui/nodes.ts"
import {
  diffNameSets,
} from "../names.ts"
import {
  rawValueAtSegments,
} from "../walk.ts"
import {
  expressionReference,
} from "../expressions/reference.ts"

export function validateRouteHandoffs({
  resource,
  routes,
  uiNodes,
  functionsByNamespace,
  issues,
}: {
  readonly resource: string
  readonly routes: readonly DeclaredRoute[]
  readonly uiNodes: ReadonlyMap<string, DeclaredUiNode> | undefined
  readonly functionsByNamespace: ContractFunctionsByNamespace
  readonly issues: CamConformanceIssue[]
}): void {
  const routesByName = new Map(routes.map((route) => [route.name, route]))

  for (const route of routes) {
    if (route.kind === "read") {
      if (uiNodes === undefined) continue
      validateUiHandoff(resource, route, uiNodes, issues)
      continue
    }
    validateRouteHandoff(resource, route, routesByName, functionsByNamespace, issues)
  }
}

function validateUiHandoff(
  resource: string,
  route: DeclaredRoute,
  uiNodes: ReadonlyMap<string, DeclaredUiNode>,
  issues: CamConformanceIssue[],
): void {
  const node = uiNodes.get(route.then.function)
  if (node === undefined) {
    issues.push(handoffIssue(resource, `routes.${route.name}.then.function`, `route renders unknown UI node: ${route.then.function}`))
    return
  }
  if (node.requires === undefined) return

  validateNamedHandoffArgs({
    resource,
    path: `routes.${route.name}.then.args`,
    expectedNames: node.requires,
    actualNames: Object.keys(route.then.args),
    destination: `UI node ${node.name}`,
    issues,
  })
}

function validateRouteHandoff(
  resource: string,
  route: DeclaredRoute,
  routesByName: ReadonlyMap<string, DeclaredRoute>,
  functionsByNamespace: ContractFunctionsByNamespace,
  issues: CamConformanceIssue[],
): void {
  const nextRoute = routesByName.get(route.then.function)
  if (nextRoute === undefined) {
    issues.push(handoffIssue(resource, `routes.${route.name}.then.function`, `write route continues to unknown route: ${route.then.function}`))
    return
  }

  validateNamedHandoffArgs({
    resource,
    path: `routes.${route.name}.then.args`,
    expectedNames: nextRoute.inputs,
    actualNames: Object.keys(route.then.args),
    destination: `route ${nextRoute.name}`,
    issues,
  })
  validateRouteHandoffAbi(resource, route, nextRoute, functionsByNamespace, issues)
}

function validateRouteHandoffAbi(
  resource: string,
  route: DeclaredRoute,
  nextRoute: DeclaredRoute,
  functionsByNamespace: ContractFunctionsByNamespace,
  issues: CamConformanceIssue[],
): void {
  const functions = functionsByNamespace.get(nextRoute.call.namespace)
  if (functions === undefined) return

  const fn = resolvedAbiFunction(nextRoute.call.function, functions)
  if (fn === undefined) return

  const thenArgsWithKnownInputs = materializeTemplateValues(route.then.args, route.call.args)
  for (const input of fn.inputs) {
    if (!Object.hasOwn(nextRoute.call.args, input.name)) continue

    const resolved = knownRouteCallValue(nextRoute.call.args[input.name], (segments) => {
      const value = rawValueAtSegments(thenArgsWithKnownInputs, segments)
      return value === undefined
        ? undefined
        : {
          value,
          pathSuffix: knownRouteCallPathSuffix(segments),
        }
    })
    if (resolved === undefined) continue

    for (const mismatch of abiArgValueMismatches(input.name, resolved.value, input.abi)) {
      const source = knownRouteCallSource(resolved, mismatch.pathSuffix)
      if (source.owner === "route") continue
      issues.push(handoffIssue(
        resource,
        `routes.${route.name}.then.args${source.pathSuffix}`,
        mismatch.message,
      ))
    }
  }
}

function materializeTemplateValues(
  template: Readonly<Record<string, unknown>>,
  inputDefaults: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const activeInputPaths = new Set<string>()
  // A write continuation can pass values that are themselves templates over
  // the write route's inputs. Preserve known leaves through that indirection so
  // the next route's ABI check reports deterministic bad fields instead of
  // treating the whole aggregate as dynamic.
  const materializeExpression = (value: unknown, resolve: (segments: readonly string[]) => unknown | undefined): unknown => {
    if (typeof value === "string") {
      const reference = expressionReference(value)
      if (reference === undefined) return value
      if (reference.root !== "inputs") return UNKNOWN_ROUTE_CALL_VALUE

      const key = reference.segments.join(".")
      if (activeInputPaths.has(key)) return UNKNOWN_ROUTE_CALL_VALUE

      const next = resolve(reference.segments)
      if (next === undefined) return UNKNOWN_ROUTE_CALL_VALUE

      activeInputPaths.add(key)
      try {
        return materializeExpression(next, resolve)
      } finally {
        activeInputPaths.delete(key)
      }
    }

    if (value === null || typeof value === "number" || typeof value === "boolean") return value
    if (Array.isArray(value)) {
      return value.map((item) => {
        const resolved = materializeExpression(item, resolve)
        return resolved === undefined ? UNKNOWN_ROUTE_CALL_VALUE : resolved
      })
    }
    if (isRecordObject(value)) {
      const output: Record<string, unknown> = {}
      for (const [name, item] of Object.entries(value)) {
        const resolved = materializeExpression(item, resolve)
        output[name] = resolved === undefined ? UNKNOWN_ROUTE_CALL_VALUE : resolved
      }
      return output
    }
    return value
  }

  const resolveInput = (segments: readonly string[]): unknown | undefined => {
    return rawValueAtSegments(inputDefaults, segments)
  }
  const result: Record<string, unknown> = {}
  for (const [name, item] of Object.entries(template)) {
    const value = materializeExpression(item, resolveInput)
    result[name] = value === undefined ? UNKNOWN_ROUTE_CALL_VALUE : value
  }
  return result
}

function validateNamedHandoffArgs({
  resource,
  path,
  expectedNames,
  actualNames,
  destination,
  issues,
}: {
  readonly resource: string
  readonly path: string
  readonly expectedNames: readonly string[]
  readonly actualNames: readonly string[]
  readonly destination: string
  readonly issues: CamConformanceIssue[]
}): void {
  diffNameSets({
    expectedNames,
    actualNames,
    onUnexpected: (name) => {
      issues.push(handoffIssue(resource, `${path}.${name}`, `unexpected continuation argument for ${destination}: ${name}`))
    },
    onMissing: (name) => {
      issues.push(handoffIssue(resource, `${path}.${name}`, `missing continuation argument for ${destination}: ${name}`))
    },
  })
}

function handoffIssue(resource: string, path: string, message: string): CamConformanceIssue {
  return conformanceIssue({
    rule: "CAM_ROUTE_HANDOFF_MISMATCH",
    resource,
    path,
    message,
  })
}
