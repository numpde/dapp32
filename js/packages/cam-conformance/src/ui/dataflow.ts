import {
  isExpressionIdentifier,
  isRecordObject,
  UI_RUNTIME_ROOTS,
} from "@cam/protocol"

import {
  conformanceIssue,
  type CamConformanceIssue,
} from "../issues.ts"
import type {
  DeclaredRoute,
} from "../manifest/routes.ts"
import {
  diffNameSets,
} from "../names.ts"
import type {
  DeclaredUiNode,
} from "./nodes.ts"
import {
  forEachUiNode,
} from "./document.ts"
import type { RawUiDocuments } from "./resources.ts"
import {
  forEachString,
} from "../walk.ts"
import {
  expressionReference,
  staticString,
  staticStringList,
} from "../expressions/reference.ts"

type UiCall = {
  readonly path: string
  readonly namespace: "routes" | "ui"
  readonly function: unknown
  readonly args: Record<string, unknown>
}

type UiDataflow = {
  readonly calls: readonly UiCall[]
}

type RouteLocalUiData = {
  readonly inputNames: Set<string>
  readonly actionPaths: string[]
}

export function validateUiDataflow({
  uiDocuments,
  routes,
  uiNodes,
  issues,
}: {
  readonly uiDocuments: RawUiDocuments
  readonly routes: readonly DeclaredRoute[]
  readonly uiNodes: ReadonlyMap<string, DeclaredUiNode> | undefined
  readonly issues: CamConformanceIssue[]
}): void {
  const routesByName = new Map(routes.map((route) => [route.name, route]))
  for (const [resource, ui] of uiDocuments) {
    const dataflow = readUiDataflow(resource, ui.nodes, issues)
    const actionInputsByPath = routeLocalActionInputs(ui.nodes, routes)

    for (const call of dataflow.calls) {
      if (!validateUiCallArgNames(resource, call, issues)) continue
      if (call.namespace === "ui") {
        if (uiNodes !== undefined) {
          validateIncludeNodeArgs(resource, call, uiNodes, issues)
        }
      } else {
        validateActionRouteArgs(resource, call, routesByName, issues)
        const localInputs = actionInputsByPath.get(call.path)
        if (localInputs !== undefined) {
          validateActionStateInputs(resource, call, localInputs, issues)
        }
      }
    }
  }
}

function readUiDataflow(
  resource: string,
  nodes: Record<string, unknown>,
  issues: CamConformanceIssue[],
): UiDataflow {
  const calls: UiCall[] = []
  forEachUiNode(nodes, (node, path) => collectUiNodeDataflow(resource, node, path, calls, issues))

  return {
    calls,
  }
}

function collectUiNodeDataflow(
  resource: string,
  value: Record<string, unknown>,
  path: string,
  calls: UiCall[],
  issues: CamConformanceIssue[],
): void {
  validateInputName(resource, value, path, issues)
  if (value.tag === "Include") {
    collectCall(value, path, "ui", calls)
  }
  if (value.tag === "Action") {
    collectCall(value, path, "routes", calls)
  }
}

function validateInputName(
  resource: string,
  value: Record<string, unknown>,
  path: string,
  issues: CamConformanceIssue[],
): void {
  if (value.tag !== "Input" || !isRecordObject(value.props)) return

  const name = staticString(value.props.name)
  if (name === undefined) return
  if (name.length === 0) {
    issues.push(dataflowIssue(resource, `${path}.props.name`, "Input name must not be empty"))
    return
  }
  if (isExpressionIdentifier(name)) return

  issues.push(dataflowIssue(resource, `${path}.props.name`, `Input name must be an expression identifier: ${name}`))
}

function collectCall(
  value: Record<string, unknown>,
  path: string,
  namespace: "routes" | "ui",
  calls: UiCall[],
): void {
  if (!isRecordObject(value.call)) return
  if (value.call.namespace !== namespace) return
  if (!isRecordObject(value.call.args)) return

  calls.push({
    path,
    namespace,
    function: value.call.function,
    args: value.call.args,
  })
}

function routeLocalActionInputs(
  nodes: Record<string, unknown>,
  routes: readonly DeclaredRoute[],
): ReadonlyMap<string, readonly ReadonlySet<string>[]> {
  const result = new Map<string, ReadonlySet<string>[]>()
  for (const route of routes) {
    if (route.then.namespace !== "ui") continue

    const rootName = staticString(route.then.function)
    if (rootName === undefined) continue

    // Runtime initializes $state from the UI tree selected by the current
    // route, not from every Input declared anywhere in ui.json.
    const localData = reachableUiData(nodes, rootName)
    for (const actionPath of localData.actionPaths) {
      const matches = result.get(actionPath)
      if (matches === undefined) {
        result.set(actionPath, [localData.inputNames])
      } else {
        matches.push(localData.inputNames)
      }
    }
  }

  return result
}

function reachableUiData(nodes: Record<string, unknown>, nodeName: string): RouteLocalUiData {
  const data: RouteLocalUiData = {
    inputNames: new Set<string>(),
    actionPaths: [],
  }
  collectNamedUiData(nodes, nodeName, [], data)
  return data
}

function collectNamedUiData(
  nodes: Record<string, unknown>,
  nodeName: string,
  stack: readonly string[],
  data: RouteLocalUiData,
): void {
  if (stack.includes(nodeName)) return

  const node = nodes[nodeName]
  if (!isRecordObject(node)) return

  collectInlineUiData(nodes, node, `nodes.${nodeName}`, [...stack, nodeName], data)
}

function collectInlineUiData(
  nodes: Record<string, unknown>,
  value: unknown,
  path: string,
  stack: readonly string[],
  data: RouteLocalUiData,
): void {
  if (!isRecordObject(value)) return

  if (value.tag === "Action") {
    data.actionPaths.push(path)
    return
  }

  const inputName = literalInputName(value)
  if (inputName !== undefined) data.inputNames.add(inputName)

  if (value.tag === "Include") {
    const targetName = isRecordObject(value.call) ? staticString(value.call.function) : undefined
    if (targetName !== undefined) collectNamedUiData(nodes, targetName, stack, data)
  }

  if (Array.isArray(value.children)) {
    value.children.forEach((child, index) => {
      collectInlineUiData(nodes, child, `${path}.children.${index}`, stack, data)
    })
  }
}

function validateUiCallArgNames(resource: string, call: UiCall, issues: CamConformanceIssue[]): boolean {
  let valid = true
  if (Object.prototype.hasOwnProperty.call(call.args, "")) {
    issues.push(dataflowIssue(resource, `${call.path}.call.args`, "UI call argument name must not be empty"))
    valid = false
  }

  if (call.namespace === "ui") {
    for (const name of Object.keys(call.args)) {
      if (UI_RUNTIME_ROOTS.has(name)) {
        issues.push(dataflowIssue(resource, `${call.path}.call.args.${name}`, `UI call argument must not shadow runtime root: ${name}`))
        valid = false
      }
    }
  }

  return valid
}

function validateIncludeNodeArgs(
  resource: string,
  include: UiCall,
  uiNodes: ReadonlyMap<string, DeclaredUiNode>,
  issues: CamConformanceIssue[],
): void {
  const functionNames = staticStringList(include.function)
  if (functionNames === undefined) return
  if (!validateStaticCallTargets(resource, `${include.path}.call.function`, "UI Include", functionNames, issues)) return

  for (const functionName of functionNames) {
    const node = uiNodes.get(functionName)
    if (node === undefined) {
      issues.push(dataflowIssue(
        resource,
        `${include.path}.call.function`,
        `UI Include calls unknown UI node: ${functionName}`,
      ))
      continue
    }
    if (node.requires === undefined) continue

    validateExactNames({
      resource,
      path: `${include.path}.call.args`,
      expectedNames: node.requires,
      actualNames: Object.keys(include.args),
      destination: `UI node ${node.name}`,
      issues,
    })
  }
}

function validateActionRouteArgs(
  resource: string,
  action: UiCall,
  routesByName: ReadonlyMap<string, DeclaredRoute>,
  issues: CamConformanceIssue[],
): void {
  const functionNames = staticStringList(action.function)
  if (functionNames === undefined) return
  if (!validateStaticCallTargets(resource, `${action.path}.call.function`, "UI Action route", functionNames, issues)) return
  if (functionNames.length !== 1) {
    issues.push(dataflowIssue(resource, `${action.path}.call.function`, "UI Action route must select exactly one route"))
    return
  }

  const [functionName] = functionNames

  const route = routesByName.get(functionName)
  if (route === undefined) {
    issues.push(dataflowIssue(
      resource,
      `${action.path}.call.function`,
      `UI action calls unknown route: ${functionName}`,
    ))
    return
  }

  validateExactNames({
    resource,
    path: `${action.path}.call.args`,
    expectedNames: route.inputs,
    actualNames: Object.keys(action.args),
    destination: `route ${route.name}`,
    issues,
  })
}

function validateStaticCallTargets(
  resource: string,
  path: string,
  label: string,
  names: readonly string[],
  issues: CamConformanceIssue[],
): boolean {
  let valid = true
  const seen = new Set<string>()
  for (const name of names) {
    if (name.length === 0) {
      issues.push(dataflowIssue(resource, path, `${label} target must not be empty`))
      valid = false
    } else if (seen.has(name)) {
      issues.push(dataflowIssue(resource, path, `${label} target must not be duplicated: ${name}`))
      valid = false
    }
    seen.add(name)
  }

  return valid
}

function literalInputName(node: Record<string, unknown>): string | undefined {
  if (node.tag !== "Input" || !isRecordObject(node.props)) return undefined

  const name = node.props.name
  // Runtime initial state can only be proven statically for literal names.
  // Dynamic Input names may still be runtime-valid, but they cannot justify a
  // conformance claim that $state.<name> is available in this view.
  const staticName = staticString(name)
  if (staticName === "" || staticName === undefined) return undefined
  return isExpressionIdentifier(staticName) ? staticName : undefined
}

function validateActionStateInputs(
  resource: string,
  action: UiCall,
  routeLocalInputNames: readonly ReadonlySet<string>[],
  issues: CamConformanceIssue[],
): void {
  forEachString(action.args, "", (value, suffix) => {
    const path = `${action.path}.call.args${suffix.length === 0 ? "" : `.${suffix}`}`
    const stateInput = referencedStateInput(value)
    if (stateInput === undefined) return

    if (stateInput.length === 0) {
      issues.push(dataflowIssue(
        resource,
        path,
        "UI action state expression must name an input",
      ))
      return
    }

    if (routeLocalInputNames.length === 0) return

    if (routeLocalInputNames.some((inputNames) => !inputNames.has(stateInput))) {
      issues.push(dataflowIssue(
        resource,
        path,
        `UI action references state without a matching route-local Input name: ${stateInput}`,
      ))
    }
  })
}

function referencedStateInput(value: string): string | undefined {
  const reference = expressionReference(value)
  if (reference === undefined) return undefined

  const { root, segments } = reference
  const firstSegment = segments[0]
  if (root !== "state") return undefined
  if (firstSegment === undefined || !isExpressionIdentifier(firstSegment)) return ""
  return firstSegment
}

function validateExactNames({
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
      issues.push(dataflowIssue(resource, `${path}.${name}`, `unexpected UI call argument for ${destination}: ${name}`))
    },
    onMissing: (name) => {
      issues.push(dataflowIssue(resource, `${path}.${name}`, `missing UI call argument for ${destination}: ${name}`))
    },
  })
}

function dataflowIssue(resource: string, path: string, message: string): CamConformanceIssue {
  return conformanceIssue({
    rule: "CAM_UI_DATAFLOW_MISMATCH",
    resource,
    path,
    message,
  })
}
