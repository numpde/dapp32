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
  ResourceDeclaration,
} from "../resources/declarations.ts"
import type {
  DeclaredUiNode,
} from "./nodes.ts"
import {
  forEachUiNode,
  readRawUiDocument,
} from "./document.ts"
import {
  forEachString,
} from "../walk.ts"
import {
  expressionReference,
  isExpressionIdentifier,
} from "../expressions/reference.ts"

type UiCall = {
  readonly path: string
  readonly function: unknown
  readonly args: Record<string, unknown>
}

type UiDataflow = {
  readonly inputNames: ReadonlySet<string>
  readonly routeCalls: readonly UiCall[]
  readonly includeCalls: readonly UiCall[]
}

export function validateUiDataflow({
  resources,
  declarations,
  routes,
  uiNodes,
  issues,
}: {
  readonly resources: ReadonlyMap<string, Uint8Array>
  readonly declarations: readonly ResourceDeclaration[]
  readonly routes: readonly DeclaredRoute[]
  readonly uiNodes: ReadonlyMap<string, DeclaredUiNode> | undefined
  readonly issues: CamConformanceIssue[]
}): void {
  const routesByName = new Map(routes.map((route) => [route.name, route]))
  for (const declaration of declarations) {
    if (declaration.namespaceType !== "ui") continue
    const bytes = resources.get(declaration.uri)
    if (bytes === undefined) continue

    const dataflow = readUiDataflow(bytes)
    if (dataflow === undefined) continue

    if (uiNodes !== undefined) {
      for (const include of dataflow.includeCalls) {
        validateIncludeNodeArgs(declaration.uri, include, uiNodes, issues)
      }
    }
    for (const action of dataflow.routeCalls) {
      validateActionRouteArgs(declaration.uri, action, routesByName, issues)
      validateActionStateInputs(declaration.uri, action, dataflow.inputNames, issues)
    }
  }
}

function readUiDataflow(bytes: Uint8Array): UiDataflow | undefined {
  const ui = readRawUiDocument(bytes)
  if (ui === undefined) return undefined

  const inputNames = new Set<string>()
  const routeCalls: UiCall[] = []
  const includeCalls: UiCall[] = []
  forEachUiNode(ui.nodes, (node, path) => collectUiNodeDataflow(node, path, inputNames, routeCalls, includeCalls))

  return {
    inputNames,
    routeCalls,
    includeCalls,
  }
}

function collectUiNodeDataflow(
  value: Record<string, unknown>,
  path: string,
  inputNames: Set<string>,
  routeCalls: UiCall[],
  includeCalls: UiCall[],
): void {
  if (value.tag === "Input") {
    collectInputName(value, inputNames)
  }
  if (value.tag === "Include") {
    collectCall(value, path, "ui", includeCalls)
  }
  if (value.tag === "Action") {
    collectCall(value, path, "routes", routeCalls)
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
    function: value.call.function,
    args: value.call.args,
  })
}

function validateIncludeNodeArgs(
  resource: string,
  include: UiCall,
  uiNodes: ReadonlyMap<string, DeclaredUiNode>,
  issues: CamConformanceIssue[],
): void {
  if (typeof include.function !== "string") return
  if (include.function.startsWith("$")) return

  const node = uiNodes.get(include.function)
  if (node === undefined) {
    issues.push(dataflowIssue(
      resource,
      `${include.path}.call.function`,
      `UI Include calls unknown UI node: ${include.function}`,
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
  if (typeof action.function !== "string") return
  if (action.function.startsWith("$")) return

  const route = routesByName.get(action.function)
  if (route === undefined) {
    issues.push(dataflowIssue(
      resource,
      `${action.path}.call.function`,
      `UI action calls unknown route: ${action.function}`,
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
