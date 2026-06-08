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
  knownRouteCallValue,
  type KnownRouteCallSource,
  type KnownRouteCallValue,
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

  for (const input of fn.inputs) {
    if (!Object.hasOwn(nextRoute.call.args, input.name)) continue

    const resolved = knownRouteCallValue(nextRoute.call.args[input.name], (segments) => {
      const value = valueAtSegments(route.then.args, segments)
      return value === undefined
        ? undefined
        : {
          value,
          pathSuffix: segments.map((segment) => `.${segment}`).join(""),
        }
    })
    if (resolved === undefined) continue

    for (const mismatch of abiArgValueMismatches(input.name, resolved.value, input.abi)) {
      const source = sourceForMismatch(resolved, mismatch.pathSuffix)
      if (source.owner === "route") continue
      issues.push(handoffIssue(
        resource,
        `routes.${route.name}.then.args${source.pathSuffix}`,
        mismatch.message,
      ))
    }
  }
}

function sourceForMismatch(value: KnownRouteCallValue, pathSuffix: string): KnownRouteCallSource {
  const source = value.paths.get(pathSuffix)
  return source === undefined
    ? { owner: value.source.owner, pathSuffix: `${value.source.pathSuffix}${pathSuffix}` }
    : source
}

function valueAtSegments(value: unknown, segments: readonly string[]): unknown | undefined {
  const [segment, ...rest] = segments
  if (segment === undefined) return value
  if (Array.isArray(value) && isArrayIndex(segment)) {
    return valueAtSegments(value[Number(segment)], rest)
  }
  if (isRecordObject(value) && Object.hasOwn(value, segment)) {
    return valueAtSegments(value[segment], rest)
  }
  return undefined
}

function isArrayIndex(value: string): boolean {
  return value === "0" || /^[1-9][0-9]*$/.test(value)
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
