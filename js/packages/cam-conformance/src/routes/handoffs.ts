import type {
  CamConformanceIssue,
} from "../issues.ts"
import type {
  DeclaredRoute,
} from "../manifest/routes.ts"
import type {
  DeclaredUiNode,
} from "../ui/nodes.ts"

export function validateRouteHandoffs({
  resource,
  routes,
  uiNodes,
  issues,
}: {
  readonly resource: string
  readonly routes: readonly DeclaredRoute[]
  readonly uiNodes: ReadonlyMap<string, DeclaredUiNode> | undefined
  readonly issues: CamConformanceIssue[]
}): void {
  const routesByName = new Map(routes.map((route) => [route.name, route]))

  for (const route of routes) {
    if (route.kind === "read") {
      if (uiNodes === undefined) continue
      validateUiHandoff(resource, route, uiNodes, issues)
      continue
    }
    validateRouteHandoff(resource, route, routesByName, issues)
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
  const expected = new Set(expectedNames)
  const actual = new Set(actualNames)

  for (const name of actual) {
    if (!expected.has(name)) {
      issues.push(handoffIssue(resource, `${path}.${name}`, `unexpected continuation argument for ${destination}: ${name}`))
    }
  }

  for (const name of expected) {
    if (!actual.has(name)) {
      issues.push(handoffIssue(resource, `${path}.${name}`, `missing continuation argument for ${destination}: ${name}`))
    }
  }
}

function handoffIssue(resource: string, path: string, message: string): CamConformanceIssue {
  return {
    rule: "CAM_ROUTE_HANDOFF_MISMATCH",
    severity: "error",
    resource,
    path,
    message,
  }
}
