import {
  isRecordObject,
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
  isExpressionIdentifier,
} from "../expressions/reference.ts"

type UiCall = {
  readonly path: string
  readonly namespace: "routes" | "ui"
  readonly function: unknown
  readonly args: Record<string, unknown>
}

type UiDataflow = {
  readonly inputNames: ReadonlySet<string>
  readonly calls: readonly UiCall[]
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
    const dataflow = readUiDataflow(ui.nodes)

    for (const call of dataflow.calls) {
      if (!validateUiCallArgNames(resource, call, issues)) continue
      if (call.namespace === "ui") {
        if (uiNodes !== undefined) {
          validateIncludeNodeArgs(resource, call, uiNodes, issues)
        }
      } else {
        validateActionRouteArgs(resource, call, routesByName, issues)
        validateActionStateInputs(resource, call, dataflow.inputNames, issues)
      }
    }
  }
}

function readUiDataflow(nodes: Record<string, unknown>): UiDataflow {
  const inputNames = new Set<string>()
  const calls: UiCall[] = []
  forEachUiNode(nodes, (node, path) => collectUiNodeDataflow(node, path, inputNames, calls))

  return {
    inputNames,
    calls,
  }
}

function collectUiNodeDataflow(
  value: Record<string, unknown>,
  path: string,
  inputNames: Set<string>,
  calls: UiCall[],
): void {
  if (value.tag === "Input") {
    collectInputName(value, inputNames)
  }
  if (value.tag === "Include") {
    collectCall(value, path, "ui", calls)
  }
  if (value.tag === "Action") {
    collectCall(value, path, "routes", calls)
  }
}

function collectInputName(node: Record<string, unknown>, inputNames: Set<string>): void {
  if (!isRecordObject(node.props)) return

  const name = node.props.name
  // Only literal Input names can statically prove a $state.<name> reference.
  // Dynamic names remain runtime-valid, but they cannot satisfy this authoring
  // conformance check.
  if (typeof name === "string" && name.length > 0 && !name.startsWith("$")) {
    inputNames.add(name)
  }
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

function validateUiCallArgNames(resource: string, call: UiCall, issues: CamConformanceIssue[]): boolean {
  if (!Object.prototype.hasOwnProperty.call(call.args, "")) return true

  issues.push(dataflowIssue(resource, `${call.path}.call.args`, "UI call argument name must not be empty"))
  return false
}

function validateIncludeNodeArgs(
  resource: string,
  include: UiCall,
  uiNodes: ReadonlyMap<string, DeclaredUiNode>,
  issues: CamConformanceIssue[],
): void {
  const functionName = literalCallFunction(include.function)
  if (functionName === undefined) return

  const node = uiNodes.get(functionName)
  if (node === undefined) {
    issues.push(dataflowIssue(
      resource,
      `${include.path}.call.function`,
      `UI Include calls unknown UI node: ${functionName}`,
    ))
    return
  }
  if (node.requires === undefined) return

  validateExactNames({
    resource,
    path: `${include.path}.call.args`,
    expectedNames: node.requires,
    actualNames: Object.keys(include.args),
    destination: `UI node ${node.name}`,
    issues,
  })
}

function validateActionRouteArgs(
  resource: string,
  action: UiCall,
  routesByName: ReadonlyMap<string, DeclaredRoute>,
  issues: CamConformanceIssue[],
): void {
  const functionName = literalCallFunction(action.function)
  if (functionName === undefined) return

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

function literalCallFunction(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined
  if (expressionReference(value) !== undefined) return undefined
  return value.startsWith("$$") ? value.slice(1) : value
}

function validateActionStateInputs(
  resource: string,
  action: UiCall,
  inputNames: ReadonlySet<string>,
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

    if (!inputNames.has(stateInput)) {
      issues.push(dataflowIssue(
        resource,
        path,
        `UI action references state without a matching Input name: ${stateInput}`,
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
